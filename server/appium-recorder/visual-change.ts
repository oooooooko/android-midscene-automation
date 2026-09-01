import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export type VisualChangeRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VisualChangeCheckInput = {
  captureScreenshot: () => Promise<Buffer>;
  wait: (ms: number) => Promise<void>;
  region: VisualChangeRegion;
  durationMs: number;
  intervalMs: number;
  changeRatioThreshold: number;
  pixelmatchThreshold: number;
};

export type VisualChangeFrameCompareInput = {
  baselineScreenshot: Buffer;
  comparisonScreenshot: Buffer;
  region: VisualChangeRegion;
  changeRatioThreshold: number;
  pixelmatchThreshold: number;
};

export type VisualChangeCheckResult = {
  passed: boolean;
  region: VisualChangeRegion;
  durationMs: number;
  intervalMs: number;
  sampleCount: number;
  changeRatioThreshold: number;
  maxChangeRatio: number;
  baselineBase64: string;
  comparisonBase64: string;
  diffBase64: string;
  message: string;
};

function clampInteger(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeRegion(region: VisualChangeRegion, imageWidth: number, imageHeight: number) {
  const x = clampInteger(region.x, 0, Math.max(0, imageWidth - 1));
  const y = clampInteger(region.y, 0, Math.max(0, imageHeight - 1));
  const width = clampInteger(region.width, 1, imageWidth - x);
  const height = clampInteger(region.height, 1, imageHeight - y);
  return { x, y, width, height };
}

function readPng(buffer: Buffer) {
  try {
    return PNG.sync.read(buffer);
  } catch (error) {
    throw new Error('截图不是有效的 PNG 数据', { cause: error });
  }
}

function cropPng(source: PNG, region: VisualChangeRegion) {
  const crop = new PNG({ width: region.width, height: region.height });
  for (let row = 0; row < region.height; row += 1) {
    const sourceStart = ((region.y + row) * source.width + region.x) * 4;
    const sourceEnd = sourceStart + region.width * 4;
    const targetStart = row * region.width * 4;
    source.data.copy(crop.data, targetStart, sourceStart, sourceEnd);
  }
  return crop;
}

function pngToBase64(png: PNG) {
  return PNG.sync.write(png).toString('base64');
}

function compareCroppedImages(
  baseline: PNG,
  current: PNG,
  pixelmatchThreshold: number,
) {
  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const differentPixels = pixelmatch(
    baseline.data,
    current.data,
    diff.data,
    baseline.width,
    baseline.height,
    {
      threshold: pixelmatchThreshold,
      includeAA: true,
    },
  );
  const totalPixels = baseline.width * baseline.height;
  return {
    diff,
    changedRatio: totalPixels ? (differentPixels / totalPixels) * 100 : 0,
  };
}

// Screenshots can contain tiny encoding or antialiasing differences, so the
// caller provides a ratio threshold instead of expecting exact image equality.
export function compareVisualChangeFrames(input: VisualChangeFrameCompareInput): VisualChangeCheckResult {
  const baselineScreenshot = readPng(input.baselineScreenshot);
  const comparisonScreenshot = readPng(input.comparisonScreenshot);
  const region = normalizeRegion(
    input.region,
    Math.min(baselineScreenshot.width, comparisonScreenshot.width),
    Math.min(baselineScreenshot.height, comparisonScreenshot.height),
  );
  const baseline = cropPng(baselineScreenshot, region);
  const comparison = cropPng(comparisonScreenshot, region);
  const diff = compareCroppedImages(baseline, comparison, input.pixelmatchThreshold);
  const passed = diff.changedRatio >= input.changeRatioThreshold;
  return {
    passed,
    region,
    durationMs: 0,
    intervalMs: 0,
    sampleCount: 2,
    changeRatioThreshold: input.changeRatioThreshold,
    maxChangeRatio: diff.changedRatio,
    baselineBase64: pngToBase64(baseline),
    comparisonBase64: pngToBase64(comparison),
    diffBase64: pngToBase64(diff.diff),
    message: passed
      ? `起止节点截图发生变化，变化比例 ${diff.changedRatio.toFixed(2)}%，达到阈值 ${input.changeRatioThreshold}%`
      : `起止节点截图未发生明显变化，变化比例 ${diff.changedRatio.toFixed(2)}%，低于阈值 ${input.changeRatioThreshold}%`,
  };
}

export async function detectVisualChange(input: VisualChangeCheckInput): Promise<VisualChangeCheckResult> {
  const firstScreenshot = readPng(await input.captureScreenshot());
  const region = normalizeRegion(input.region, firstScreenshot.width, firstScreenshot.height);
  const baseline = cropPng(firstScreenshot, region);
  let sampleCount = 0;
  let maxChangeRatio = 0;
  let comparison = baseline;
  let diffImage = new PNG({ width: baseline.width, height: baseline.height });
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(1000, input.durationMs);
  const intervalMs = Math.max(200, input.intervalMs);

  while (Date.now() < deadline) {
    await input.wait(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    const currentScreenshot = readPng(await input.captureScreenshot());
    const current = cropPng(currentScreenshot, region);
    const diff = compareCroppedImages(baseline, current, input.pixelmatchThreshold);
    sampleCount += 1;
    comparison = current;
    diffImage = diff.diff;
    maxChangeRatio = Math.max(maxChangeRatio, diff.changedRatio);
    if (diff.changedRatio >= input.changeRatioThreshold) {
      return {
        passed: true,
        region,
        durationMs: input.durationMs,
        intervalMs,
        sampleCount,
        changeRatioThreshold: input.changeRatioThreshold,
        maxChangeRatio,
        baselineBase64: pngToBase64(baseline),
        comparisonBase64: pngToBase64(comparison),
        diffBase64: pngToBase64(diffImage),
        message: `检测到画面变化，最大变化比例 ${maxChangeRatio.toFixed(2)}%，达到阈值 ${input.changeRatioThreshold}%`,
      };
    }
  }

  return {
    passed: false,
    region,
    durationMs: input.durationMs,
    intervalMs,
    sampleCount,
    changeRatioThreshold: input.changeRatioThreshold,
    maxChangeRatio,
    baselineBase64: pngToBase64(baseline),
    comparisonBase64: pngToBase64(comparison),
    diffBase64: pngToBase64(diffImage),
    message: `${input.durationMs}ms 内目标区域未发生明显变化，最大变化比例 ${maxChangeRatio.toFixed(2)}%，低于阈值 ${input.changeRatioThreshold}%`,
  };
}

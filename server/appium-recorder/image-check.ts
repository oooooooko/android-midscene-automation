import { PNG } from 'pngjs';
import { validateImageCheck, type ImageCheckConfig, type ImageCheckResult } from '../../src/appium-recorder/image-check';
import type { AppiumVisualChangeRegion } from '../../src/appium-recorder/types';

// 延迟初始化，普通回放不加载 WASM；仅缓存运行库，不缓存设备截图或检测结果。
let runtime: Promise<typeof import('@techstark/opencv-js')> | undefined;
async function openCv() {
  runtime ??= import('@techstark/opencv-js').then(async module => {
    const cv = await module.default;
    if (!cv.Mat) await new Promise<void>(resolve => { cv.onRuntimeInitialized = resolve; });
    return cv;
  });
  return runtime;
}

export function readImage(buffer: Buffer) {
  // 先检查 IHDR 尺寸，再解码，防止超大图片耗尽内存。
  if (buffer.length < 24 || buffer.length > 24 * 1024 * 1024 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('截图或模板不是有效 PNG');
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (!width || !height || width * height > 16000000) throw new Error('图片尺寸过大或无效');
  return PNG.sync.read(buffer);
}

export function cropImage(source: PNG, region: AppiumVisualChangeRegion) {
  const { x, y, width, height } = region;
  if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1
    || x + width > source.width || y + height > source.height || width * height > 4000000) throw new Error('目标区域无效、越界或超过 400 万像素');
  const image = new PNG({ width, height });
  PNG.bitblt(source, image, x, y, width, height, 0, 0);
  return image;
}

async function measure(image: PNG, baseline: PNG | undefined, templates: PNG[], config: ImageCheckConfig) {
  const cv = await openCv();
  const mat = cv.matFromArray(image.height, image.width, cv.CV_8UC4, image.data);
  const rgb = new cv.Mat();
  try {
    cv.cvtColor(mat, rgb, cv.COLOR_RGBA2RGB);
    if (config.mode === 'template' || config.mode === 'state') {
      const scores = templates.map(template => {
        if (template.width > image.width || template.height > image.height) throw new Error(`模板 ${template.width}×${template.height} 超过实时检测区域 ${image.width}×${image.height}，请扩大检测区域或重新采集对应组件的模板`);
        const raw = cv.matFromArray(template.height, template.width, cv.CV_8UC4, template.data);
        const target = new cv.Mat(), output = new cv.Mat(), mask = new cv.Mat();
        try {
          cv.cvtColor(raw, target, cv.COLOR_RGBA2RGB);
          // SQDIFF 不会把零方差的纯色模板错误识别成满分；统一转换为越大越匹配的得分。
          cv.matchTemplate(rgb, target, output, cv.TM_SQDIFF);
          const distance = cv.minMaxLoc(output, mask).minVal / (template.width * template.height * 3 * 255 * 255);
          return Math.max(0, Math.min(1, 1 - Math.sqrt(Math.max(0, distance))));
        } finally { raw.delete(); target.delete(); output.delete(); mask.delete(); }
      });
      const positive = scores[0]!;
      if (config.mode === 'template') return { matched: config.expectation === 'present' ? positive >= config.threshold : positive < config.threshold, metrics: { '模板得分': positive } };
      const negative = scores[1]!;
      const gap = Math.abs(positive - negative);
      return { matched: Math.max(positive, negative) < config.threshold || gap < config.minScoreGap ? null : positive > negative,
        metrics: { '选中得分': positive, '未选中得分': negative, '得分差': gap } };
    }
    const mask = new cv.Mat();
    try {
      if (config.mode === 'black') {
        const gray = new cv.Mat();
        try { cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY); cv.threshold(gray, mask, config.tolerance, 255, cv.THRESH_BINARY_INV); }
        finally { gray.delete(); }
      } else if (config.mode === 'color') {
        const channels = [1, 3, 5].map(index => parseInt(config.color.slice(index, index + 2), 16));
        const low = new cv.Mat(rgb.rows, rgb.cols, rgb.type(), new cv.Scalar(...channels.map(v => Math.max(0, v - config.tolerance)), 0));
        const high = new cv.Mat(rgb.rows, rgb.cols, rgb.type(), new cv.Scalar(...channels.map(v => Math.min(255, v + config.tolerance)), 255));
        try { cv.inRange(rgb, low, high, mask); } finally { low.delete(); high.delete(); }
      } else {
        if (!baseline || baseline.width !== image.width || baseline.height !== image.height) throw new Error('采样期间目标区域尺寸发生变化');
        const first = cv.matFromArray(baseline.height, baseline.width, cv.CV_8UC4, baseline.data);
        const diff = new cv.Mat();
        try {
          cv.absdiff(mat, first, diff);
          // 按 RGB 任一通道差异统计，避免不同颜色在灰度化后抵消。
          const bytes = new Uint8Array(image.width * image.height);
          for (let i = 0; i < bytes.length; i++) bytes[i] = Math.max(diff.data[i * 4]!, diff.data[i * 4 + 1]!, diff.data[i * 4 + 2]!) > config.tolerance ? 255 : 0;
          const binary = cv.matFromArray(image.height, image.width, cv.CV_8UC1, bytes);
          try { binary.copyTo(mask); } finally { binary.delete(); }
        } finally { first.delete(); diff.delete(); }
      }
      const ratio = cv.countNonZero(mask) / (image.width * image.height) * 100;
      return { matched: ratio >= config.ratio, metrics: { [config.mode === 'black' ? '暗色像素占比 %' : config.mode === 'color' ? '目标颜色占比 %' : '变化比例 %']: ratio } };
    } finally { mask.delete(); }
  } finally { mat.delete(); rgb.delete(); }
}

export async function checkImage(input: {
  config: ImageCheckConfig;
  capture: () => Promise<Buffer>;
  resolveRegion?: () => Promise<AppiumVisualChangeRegion>;
  signal?: AbortSignal;
  wait: (ms: number) => Promise<void>;
  now?: () => number;
  saveImages?: boolean;
}): Promise<ImageCheckResult> {
  const now = input.now || Date.now, started = now();
  const config = input.config;
  const result: ImageCheckResult = { result: null, mode: config?.mode, region: config?.region, durationMs: 0, sampleCount: 0, metrics: {}, images: [], message: '' };
  try {
    validateImageCheck(config);
    await openCv();
    const templates = ['template', 'state'].includes(config.mode)
      ? [config.template!, ...(config.mode === 'state' ? [config.negativeTemplate!] : [])].map(value => readImage(Buffer.from(value, 'base64'))) : [];
    for (const template of templates) {
      for (let i = 3; i < template.data.length; i += 4) if (template.data[i] !== 255) throw new Error('模板含透明像素，请使用设备实际截图采集');
    }
    let baseline: PNG | undefined, last: PNG | undefined, consecutive = 0;
    let maximum = 0, observedAt = now();
    const keep = (label: string, image: PNG) => {
      if (input.saveImages !== false) result.images.push({ label, base64: PNG.sync.write(image).toString('base64') });
    };
    templates.forEach((image, index) => keep(index ? '未选中模板' : config.mode === 'state' ? '选中模板' : '模板', image));
    while (true) {
      input.signal?.throwIfAborted();
      const region = config.target === 'element' ? await input.resolveRegion?.() : config.region;
      if (!region) throw new Error('未找到目标元素');
      const source = readImage(await input.capture());
      input.signal?.throwIfAborted();
      if (config.target === 'region' && (source.width !== config.screenWidth || source.height !== config.screenHeight)) throw new Error('屏幕尺寸与采集时不一致，请重新框选区域');
      const current = cropImage(source, region);
      result.region = region;
      result.sampleCount++;
      last = current;
      if (!baseline) { baseline = current; observedAt = now(); keep('首帧', current); }
      const measurement = await measure(current, baseline, templates, config);
      result.metrics = { ...measurement.metrics };
      input.signal?.throwIfAborted();
      if (config.mode === 'state') {
        if (measurement.matched === null) throw new Error('双模板均未达到阈值或得分过于接近');
        result.result = measurement.matched;
        break;
      }
      if (config.mode === 'change') {
        maximum = Math.max(maximum, result.metrics['变化比例 %'] || 0);
        result.metrics['最大变化比例 %'] = maximum;
        const changed = maximum >= config.ratio;
        if (changed || (result.sampleCount >= 2 && now() - observedAt >= config.durationMs)) {
          result.result = config.expectation === 'present' ? changed : !changed;
          break;
        }
      } else {
        consecutive = measurement.matched ? consecutive + 1 : 0;
        result.metrics['连续满足帧数'] = consecutive;
        if (consecutive >= config.consecutive) { result.result = true; break; }
        if (now() - observedAt >= config.durationMs) { result.result = false; break; }
      }
      await input.wait(Math.min(config.intervalMs, Math.max(1, config.durationMs - (now() - observedAt))));
    }
    if (last) keep('判定帧', last);
    result.message = result.result ? '条件成立' : '条件不成立';
  } catch (error) {
    if (input.signal?.aborted) throw error;
    result.message = `无法判定：${error instanceof Error ? error.message : '图像检测异常'}`;
    result.result = null;
  }
  result.durationMs = now() - started;
  return result;
}

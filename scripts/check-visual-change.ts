import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { compareVisualChangeFrames, detectVisualChange } from '../server/appium-recorder/visual-change';

function pngBuffer(color: [number, number, number, number]) {
  const png = new PNG({ width: 12, height: 12 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = color[0];
    png.data[index + 1] = color[1];
    png.data[index + 2] = color[2];
    png.data[index + 3] = color[3];
  }
  return PNG.sync.write(png);
}

async function main() {
  const black = pngBuffer([0, 0, 0, 255]);
  const white = pngBuffer([255, 255, 255, 255]);

  let changedCalls = 0;
  const changed = await detectVisualChange({
    captureScreenshot: async () => (changedCalls++ === 0 ? black : white),
    wait: async () => undefined,
    region: { x: 2, y: 2, width: 8, height: 8 },
    durationMs: 1000,
    intervalMs: 200,
    changeRatioThreshold: 2,
    pixelmatchThreshold: 0.1,
  });
  assert.equal(changed.passed, true);
  assert.ok(changed.maxChangeRatio >= 99);
  assert.ok(changed.diffBase64);

  const frameChanged = compareVisualChangeFrames({
    baselineScreenshot: black,
    comparisonScreenshot: white,
    region: { x: 2, y: 2, width: 8, height: 8 },
    changeRatioThreshold: 2,
    pixelmatchThreshold: 0.1,
  });
  assert.equal(frameChanged.passed, true);
  assert.equal(frameChanged.sampleCount, 2);

  const unchanged = await detectVisualChange({
    captureScreenshot: async () => black,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10))),
    region: { x: 2, y: 2, width: 8, height: 8 },
    durationMs: 1000,
    intervalMs: 200,
    changeRatioThreshold: 2,
    pixelmatchThreshold: 0.1,
  });
  assert.equal(unchanged.passed, false);
  assert.equal(unchanged.maxChangeRatio, 0);
  assert.ok(unchanged.baselineBase64);

  const frameUnchanged = compareVisualChangeFrames({
    baselineScreenshot: black,
    comparisonScreenshot: black,
    region: { x: 2, y: 2, width: 8, height: 8 },
    changeRatioThreshold: 2,
    pixelmatchThreshold: 0.1,
  });
  assert.equal(frameUnchanged.passed, false);
  assert.equal(frameUnchanged.maxChangeRatio, 0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

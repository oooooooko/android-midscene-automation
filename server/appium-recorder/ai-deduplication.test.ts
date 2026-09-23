// Run: npx tsx --test server/appium-recorder/ai-deduplication.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { resolveAiDeduplication } from '../../src/appium-recorder/ai-deduplication';
import { createObservationDeduplicator } from './ai-deduplication';
import { collectAiObservation } from './ai-observation';

function screenshot(color: number[], width = 96, height = 128, patch = false) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([...color, 255], i);
  if (patch) png.data.set([255, 0, 0, 255], 0);
  return PNG.sync.write(png).toString('base64');
}

const home = screenshot([30, 30, 30]), ad = screenshot([240, 240, 240]);

test('defaults and validation cover both active and inactive algorithms', () => {
  assert.equal(resolveAiDeduplication().method, 'pixelmatch');
  for (const value of [null, [], { method: 'fake' }, { pixelmatch: { threshold: NaN } },
    { pixelmatch: { maxChangedRatio: -1 } }, { opencv: { similarityThreshold: 1.1 } },
    { method: 'none', opencv: { maxDimension: 127 } }, { opencv: { maxDimension: 512.5 } }]) {
    assert.throws(() => resolveAiDeduplication(value));
  }
});

for (const method of ['pixelmatch', 'opencv', 'none'] as const) {
  test(`${method}: preserve transient ad and transitions, never share state across observations`, async () => {
    const config = resolveAiDeduplication({ method });
    const keep = await createObservationDeduplicator(config);
    const decisions = [];
    for (const frame of [home, home, ad, ad, home]) decisions.push(await keep(frame));
    assert.deepEqual(decisions, method === 'none' ? [true, true, true, true, true] : [true, false, true, false, true]);
    assert.equal(await keep(screenshot([30, 30, 30], 128, 96)), true, 'rotation must be retained');
    assert.equal(await (await createObservationDeduplicator(config))(home), true);
    assert.equal(await keep(screenshot([255, 0, 0])), true);
    assert.equal(await keep(screenshot([0, 130, 0])), true, 'different colors must not collapse into gray');
  });

  test(`${method}: full observation window survives deduplication down to one frame`, async () => {
    const samples: number[] = [];
    const result = await collectAiObservation({ durationMs: 1000, intervalMs: 500 }, async () => home,
      new AbortController().signal, frame => { samples.push(frame.index); }, resolveAiDeduplication({ method }));
    assert.ok(result.observation.durationMs >= 1000);
    assert.ok(result.observation.sampleCount >= 2);
    assert.equal(samples.length, result.observation.sampleCount);
    assert.equal(result.observation.frames.length, method === 'none' ? samples.length : 1);
    assert.equal(result.observation.deduplicationMethod, method);
    assert.equal(result.imageBase64, home);
  });
}

test('pixelmatch parameters take effect and comparison uses the last retained frame', async () => {
  const tolerant = await createObservationDeduplicator(resolveAiDeduplication());
  await tolerant(home);
  assert.equal(await tolerant(screenshot([30, 30, 30], 96, 128, true)), false);
  const strict = await createObservationDeduplicator(resolveAiDeduplication({ pixelmatch: { threshold: 0, maxChangedRatio: 0 } }));
  await strict(home);
  assert.equal(await strict(screenshot([30, 30, 30], 96, 128, true)), true);
  const gradual = await createObservationDeduplicator(resolveAiDeduplication({ pixelmatch: { threshold: 0.1, maxChangedRatio: 0 } }));
  await gradual(screenshot([100, 100, 100]));
  assert.equal(await gradual(screenshot([110, 110, 110])), false);
  assert.equal(await gradual(screenshot([130, 130, 130])), true);
});

test('OpenCV SSIM threshold takes effect on non-identical frames', async () => {
  const base = screenshot([100, 100, 100]), changed = screenshot([120, 120, 120]);
  for (const [threshold, expected] of [[0.99, true], [0.95, false]] as const) {
    const keep = await createObservationDeduplicator(resolveAiDeduplication({ method: 'opencv', opencv: { similarityThreshold: threshold, maxDimension: 128 } }));
    await keep(base);
    assert.equal(await keep(changed), expected);
  }
});

test('capture errors and cancellation stop observation rather than yielding an absence result', async () => {
  await assert.rejects(collectAiObservation({ durationMs: 1000, intervalMs: 500 }, async () => { throw new Error('capture failed'); }, new AbortController().signal), /capture failed/);
  const controller = new AbortController();
  await assert.rejects(collectAiObservation({ durationMs: 1000, intervalMs: 500 }, async () => home,
    controller.signal, () => { controller.abort(new Error('cancelled')); }), /cancelled/);
});

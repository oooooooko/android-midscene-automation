// Run: npx tsx --test server/appium-recorder/ai-observation.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { observeUntilAiMatch } from './ai-observation';
import { resolveAiDeduplication } from '../../src/appium-recorder/ai-deduplication';
import { validateAiObservation } from '../../src/appium-recorder/ai-recognition';

function image(value: number) {
  const png = new PNG({ width: 8, height: 8 });
  png.data.fill(value);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  return PNG.sync.write(png).toString('base64');
}
const home = image(30), ad = image(230);
const config = { durationMs: 2000, intervalMs: 500, mode: 'untilMatch' as const };
const signal = () => new AbortController().signal;

test('old observation settings remain batch-compatible; new mode validates', () => {
  assert.deepEqual(validateAiObservation({ durationMs: 1000, intervalMs: 500 }), { durationMs: 1000, intervalMs: 500 });
  assert.deepEqual(validateAiObservation(config), config);
  assert.throws(() => validateAiObservation({ ...config, mode: 'invalid' }));
});

test('first-frame match stops before the observation window and leaves no sampler running', async () => {
  let captures = 0;
  const result = await observeUntilAiMatch({ config, signal: signal(), capture: async () => { captures++; return ad; },
    analyze: async () => ({ result: true, reason: '广告出现' }) });
  assert.equal(result.result, true);
  assert.equal(result.observation.completion, 'matched');
  assert.equal(captures, 1);
  assert.ok(result.observation.durationMs < config.durationMs);
  await delay(550);
  assert.equal(captures, 1);
});

test('slow inference does not lose a transient frame, batches pending frames and never overlaps model requests', async () => {
  let captures = 0, active = 0, maxActive = 0, calls = 0;
  const result = await observeUntilAiMatch({ config, signal: signal(),
    capture: async () => ++captures === 2 ? ad : home,
    analyze: async frames => {
      active++; maxActive = Math.max(maxActive, active); calls++;
      try {
        if (calls === 1) { await delay(1150); assert.ok(captures >= 3); return { result: false, reason: '首页' }; }
        assert.equal(frames.length, 2, 'ad and return-home frames must both survive');
        assert.notEqual(frames[0].imageDataUrl, frames[1].imageDataUrl);
        return { result: true, reason: '第二次采样出现广告' };
      } finally { active--; }
    },
  });
  assert.equal(result.result, true);
  assert.equal(maxActive, 1);
  assert.equal(calls, 2);
  assert.equal(result.observation.frames.length, 3);
  assert.ok(result.observation.durationMs < 2000);
});

test('no match observes the full window and drains pending frames after sampling stops', async () => {
  let calls = 0;
  const result = await observeUntilAiMatch({ config: { ...config, durationMs: 1000 }, signal: signal(),
    deduplication: resolveAiDeduplication({ method: 'none' }), capture: async () => home,
    analyze: async () => { calls++; if (calls === 1) await delay(1150); return { result: false, reason: '没有广告' }; },
  });
  assert.equal(result.result, false);
  assert.equal(result.observation.completion, 'elapsed');
  assert.equal(result.observation.frames.length, result.observation.sampleCount);
  assert.equal(calls, 2);
  assert.ok(result.observation.durationMs >= 1000);
});

test('deduplication avoids repeating model requests for unchanged frames', async () => {
  const result = await observeUntilAiMatch({ config: { ...config, durationMs: 1000 }, signal: signal(), capture: async () => home,
    analyze: async () => ({ result: false, reason: '未命中' }) });
  assert.equal(result.observation.modelRequestCount, 1);
  assert.equal(result.observation.frames.length, 1);
  assert.ok(result.observation.sampleCount >= 2);
});

test('cancellation stops pending inference and sampling, errors never become false', async () => {
  const controller = new AbortController();
  let active = 0;
  const run = observeUntilAiMatch({ config, signal: controller.signal, capture: async () => home,
    analyze: async (_frames, signal) => {
      active++;
      try { controller.abort(new Error('user cancelled')); await delay(10000, undefined, { signal }); return { result: false, reason: '' }; }
      finally { active--; }
    } });
  await assert.rejects(run, /user cancelled/);
  assert.equal(active, 0);
  await assert.rejects(observeUntilAiMatch({ config, signal: signal(), capture: async () => home,
    analyze: async () => { throw new Error('model failed'); } }), /model failed/);
  await assert.rejects(observeUntilAiMatch({ config, signal: signal(), capture: async () => home,
    analyze: async () => ({ result: null, reason: '无法判断' }) }), /无法确定/);
});

test('screenshot failure aborts in-flight inference', async () => {
  let captures = 0, active = 0;
  await assert.rejects(observeUntilAiMatch({ config, signal: signal(),
    capture: async () => { if (++captures === 2) throw new Error('capture failed'); return home; },
    analyze: async (_frames, signal) => {
      active++;
      try { await delay(10000, undefined, { signal }); return { result: false, reason: '' }; }
      finally { active--; }
    },
  }), /capture failed/);
  assert.equal(active, 0);
});

test('a match cancels an in-flight screenshot without reporting a capture failure', async () => {
  let captures = 0, captureActive = 0;
  const result = await observeUntilAiMatch({ config, signal: signal(),
    capture: async signal => {
      if (++captures === 1) return ad;
      captureActive++;
      try { await delay(10000, undefined, { signal }); return home; }
      finally { captureActive--; }
    },
    analyze: async () => { await delay(650); return { result: true, reason: '命中' }; },
  });
  assert.equal(result.result, true);
  assert.equal(captures, 2);
  assert.equal(captureActive, 0);
  assert.equal(result.observation.sampleCount, 1);
});

// Run: npx tsx --test server/appium-recorder/ai-recognition.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AiInvalidResultError,
  parseAiRecognitionResult,
  resolveAiInvalidResultFallback,
} from './ai-recognition';

test('valid AI boolean results keep their original branch', () => {
  assert.deepEqual(parseAiRecognitionResult('{"result":true,"reason":"已出图"}'), { result: true, reason: '已出图' });
  assert.deepEqual(parseAiRecognitionResult('{"result":false,"reason":"仍是黑屏"}'), { result: false, reason: '仍是黑屏' });
});

test('empty, invalid and indeterminate AI answers are classified as invalid results', () => {
  for (const content of ['', 'not json', '{"result":"true"}', '{"result":null,"reason":"画面模糊"}']) {
    assert.throws(() => parseAiRecognitionResult(content), AiInvalidResultError);
  }
});

test('configured fallback applies only to invalid AI results', () => {
  const invalid = new AiInvalidResultError('没有 true/false');
  assert.equal(resolveAiInvalidResultFallback(invalid, 'yes'), true);
  assert.equal(resolveAiInvalidResultFallback(invalid, 'no'), false);
  assert.equal(resolveAiInvalidResultFallback(invalid), null);
  assert.equal(resolveAiInvalidResultFallback(new Error('network failed'), 'yes'), null);
});

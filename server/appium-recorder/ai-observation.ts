import { setTimeout as delay } from 'node:timers/promises';
import { constrainBase64ImageToMaxSize, convertBase64ImageToJpeg } from '@midscene/shared/img';
import { MAX_AI_OBSERVATION_FRAMES, type AiObservationConfig, type AiObservationFrame } from '../../src/appium-recorder/ai-recognition';
import { resolveAiDeduplication, type AiDeduplicationConfig } from '../../src/appium-recorder/ai-deduplication';
import { createObservationDeduplicator } from './ai-deduplication';

export type ObservationCapture = { imageBase64: string; elapsedMs: number; index: number };

// 采集不依赖模型响应；按实际采样时刻记录，慢设备串行截图，避免积压 ADB 请求。
export async function collectAiObservation(
  config: AiObservationConfig,
  capture: (signal: AbortSignal) => Promise<string>,
  signal: AbortSignal,
  onFrame?: (frame: ObservationCapture) => Promise<void> | void,
  deduplication: AiDeduplicationConfig = resolveAiDeduplication(),
  streaming?: { stopSignal: AbortSignal; onRetainedFrame: (frame: AiObservationFrame) => void },
) {
  signal.throwIfAborted();
  const shouldKeep = await createObservationDeduplicator(deduplication);
  signal.throwIfAborted();
  const startedAt = performance.now();
  const frames: AiObservationFrame[] = [];
  let imageBase64 = '';
  let bytes = 0;
  let sampleCount = 0;
  const activeSignal = streaming ? AbortSignal.any([signal, streaming.stopSignal]) : signal;
  try {
    while (true) {
      activeSignal.throwIfAborted();
      const captureStarted = performance.now();
      imageBase64 = await capture(activeSignal);
      activeSignal.throwIfAborted();
      const elapsedMs = Math.round(performance.now() - startedAt);
      sampleCount++;
      let retainedFrame: AiObservationFrame | undefined;
      if (await shouldKeep(imageBase64)) {
        const bounded = await constrainBase64ImageToMaxSize(`data:image/png;base64,${imageBase64}`, { maxSize: 1600 });
        const imageDataUrl = await convertBase64ImageToJpeg(bounded, 85);
        bytes += imageDataUrl.length;
        if (bytes > 24 * 1024 * 1024) throw new Error('观察画面超过 24 MB，请缩短观察时长或增大采样间隔');
        retainedFrame = { elapsedMs, imageDataUrl };
        frames.push(retainedFrame);
      }
      activeSignal.throwIfAborted();
      await onFrame?.({ imageBase64, elapsedMs, index: sampleCount });
      activeSignal.throwIfAborted();
      if (retainedFrame) streaming?.onRetainedFrame(retainedFrame);
      const now = performance.now();
      if (now - startedAt >= config.durationMs) break;
      if (sampleCount >= MAX_AI_OBSERVATION_FRAMES) throw new Error('观察帧数已达上限，尚未覆盖完整观察时长');
      const nextCapture = Math.min(startedAt + config.durationMs, captureStarted + config.intervalMs);
      await delay(Math.max(0, Math.ceil(nextCapture - now)), undefined, { signal: activeSignal });
    }
  } catch (error) {
    signal.throwIfAborted();
    const stopped = streaming?.stopSignal;
    if (!stopped?.aborted || (error !== stopped.reason && !(error instanceof Error && error.name === 'AbortError'))) throw error;
  }
  if (sampleCount < 2 && !streaming?.stopSignal.aborted) throw new Error('设备截图过慢，观察期间不足 2 帧，请增加观察时长');
  return { imageBase64, observation: { durationMs: Math.round(performance.now() - startedAt), frames, sampleCount, deduplicationMethod: deduplication.method } };
}

// 采样和识别并行；一次只发一个请求，期间积累的关键帧在下一次一起判断，避免丢掉短暂画面。
export async function observeUntilAiMatch(input: {
  config: AiObservationConfig;
  capture: (signal: AbortSignal) => Promise<string>;
  signal: AbortSignal;
  deduplication?: AiDeduplicationConfig;
  onFrame?: (frame: ObservationCapture) => Promise<void> | void;
  onProgress?: (message: string) => void;
  analyze: (frames: AiObservationFrame[], signal: AbortSignal) => Promise<{ result: boolean | null; reason: string }>;
}) {
  const stopCapture = new AbortController(), work = new AbortController();
  const signal = AbortSignal.any([input.signal, work.signal]);
  const pending: AiObservationFrame[] = [], submitted: AiObservationFrame[] = [];
  let wake: (() => void) | undefined;
  let captureDone = false, failure: unknown, failed = false, modelRequestCount = 0;
  let match: { result: boolean; reason: string } | undefined;
  const consumer = (async () => {
    while (true) {
      signal.throwIfAborted();
      if (!pending.length) {
        if (captureDone) return;
        await new Promise<void>(resolve => { wake = resolve; });
        continue;
      }
      const frames = pending.splice(0);
      submitted.push(...frames);
      modelRequestCount++;
      input.onProgress?.(`第 ${modelRequestCount} 次检测：提交 ${frames.length} 张新关键帧`);
      const result = await input.analyze(frames, signal);
      signal.throwIfAborted();
      if (typeof result.result !== 'boolean') throw new Error('AI 无法确定是否命中条件，已停止观察');
      if (result.result) {
        match = { result: true, reason: result.reason };
        stopCapture.abort();
        input.onProgress?.('检测命中，停止观察并结束当前节点');
        return;
      }
      input.onProgress?.(`第 ${modelRequestCount} 次检测未命中，继续观察或检查剩余关键帧`);
    }
  })().catch(error => { failure = error; failed = true; work.abort(error); });
  try {
    const collected = await collectAiObservation(input.config, input.capture, signal, input.onFrame, input.deduplication, {
      stopSignal: stopCapture.signal,
      onRetainedFrame: frame => { pending.push(frame); wake?.(); },
    });
    captureDone = true;
    wake?.();
    if (!match) input.onProgress?.('已到最长观察时间，等待剩余关键帧识别完成');
    await consumer;
    if (failed) throw failure;
    input.signal.throwIfAborted();
    return {
      ...collected,
      ...(match ?? { result: false, reason: '观察时段内未命中条件，所有保留的关键帧均已判断。' }),
      observation: { ...collected.observation, frames: submitted, modelRequestCount, completion: match ? 'matched' as const : 'elapsed' as const },
    };
  } finally {
    captureDone = true;
    work.abort();
    wake?.();
    await consumer;
  }
}

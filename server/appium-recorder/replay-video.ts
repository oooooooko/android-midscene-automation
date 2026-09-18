import { mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config';
import { appDataPath } from '../paths';
import { openRecordingSource, waitForVideoTask } from './scrcpy-recording-source';
import { ReplayMp4Writer } from './replay-mp4';

export type ReplayVideo = { filePath: string; fileName: string; startedAt: string; warning?: string };

// 检查 MP4 的索引和媒体块，不将大视频整体读入内存。
export async function isFinalizedMp4(path: string) {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    let offset = 0, media = false, index = false;
    const header = Buffer.alloc(16);
    while (offset + 8 <= size) {
      const { bytesRead } = await file.read(header, 0, 16, offset);
      const type = header.toString('ascii', 4, 8);
      let length = header.readUInt32BE(0);
      if (length === 1) {
        if (bytesRead < 16) return false;
        length = Number(header.readBigUInt64BE(8));
      }
      if (!length) length = size - offset;
      if (length < 8 || !Number.isSafeInteger(length) || offset + length > size) return false;
      if (type === 'mdat' && length > 8) media = true;
      if (type === 'moov' && length > 8) index = true;
      offset += length;
    }
    return media && index && offset === size;
  } finally { await file.close(); }
}

export async function startReplayVideo(deviceId: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const dir = appDataPath(loadConfig().runtime.reportOutputPath.trim() || 'output');
  await mkdir(dir, { recursive: true });
  const fileName = `replay-${Date.now()}-${randomUUID()}.mp4`;
  const filePath = join(dir, fileName);
  const startupSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30000)]);
  const source = await openRecordingSource(deviceId, startupSignal);
  return recordVideoStream(source, filePath, fileName, startupSignal);
}

// 独立于连接层，便于用真实 H.264 数据验证封装、断流和终止收尾。
export async function recordVideoStream(source: Awaited<ReturnType<typeof openRecordingSource>>, filePath: string, fileName: string, startupSignal: AbortSignal) {
  const writer = new ReplayMp4Writer(filePath);
  const reader = source.stream.getReader();
  let stopping = false;
  let warning: string | undefined;
  let readyResolve!: () => void;
  let readyReject!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  void ready.catch(() => undefined);
  let pump: Promise<void> = Promise.resolve();
  let stopTask: Promise<ReplayVideo> | undefined;
  const stop = () => stopTask ??= (async () => {
    stopping = true;
    await Promise.allSettled([reader.cancel(), source.close()]);
    await pump;
    try {
      await writer.finish();
      if (!await isFinalizedMp4(filePath)) throw new Error('录屏未生成完整 MP4');
      return { filePath, fileName, startedAt: new Date(writer.startedAt).toISOString(), warning };
    } catch (error) {
      await writer.cancel().catch(() => undefined);
      await rm(filePath, { force: true });
      throw error;
    }
  })();
  try {
    await writer.start();
    pump = (async () => {
      try {
        while (!stopping) {
          const { done, value } = await reader.read();
          if (done) {
            if (!stopping) throw new Error(`录屏视频流提前结束 ${source.diagnostics()}`);
            break;
          }
          await writer.add(value);
          if (writer.startedAt) readyResolve();
        }
      } catch (error) {
        warning = `录像可能不完整：${error instanceof Error ? error.message : String(error)}`;
        readyReject(error);
        void source.close();
      } finally { writer.end(); reader.releaseLock(); }
    })();
    await waitForVideoTask(ready, startupSignal);
    return { startedAt: new Date(writer.startedAt).toISOString(), stop };
  } catch (error) {
    await stop().catch(() => undefined);
    await rm(filePath, { force: true });
    throw error;
  }
}

import { mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config';
import { appDataPath } from '../paths';
import { openRecordingSource, waitForVideoTask } from './scrcpy-recording-source';
import { ReplayVideoSegments } from './replay-video-segments';

export type ReplayVideo = { filePath: string; fileName: string; startedAt: string; warning?: string; scriptId?: string; scriptName?: string; boundaryAt?: string; segments?: ReplayVideo[] };

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

export async function startReplayVideo(deviceId: string, signal?: AbortSignal, onLog?: (message: string) => void) {
  signal?.throwIfAborted();
  const dir = appDataPath(loadConfig().runtime.reportOutputPath.trim() || 'output');
  await mkdir(dir, { recursive: true });
  const failures: string[] = [];
  for (const profile of [
    { label: '标准（1280 / 2Mbps）', maxSize: 1280, videoBitRate: 2000000 },
    { label: '兼容（800 / 1Mbps）', maxSize: 800, videoBitRate: 1000000 },
  ]) {
    signal?.throwIfAborted();
    const fileName = `replay-${Date.now()}-${randomUUID()}.mp4`;
    const filePath = join(dir, fileName);
    const startupSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]);
    try {
      onLog?.(`录屏启动：${profile.label}，使用设备默认编码参数`);
      const source = await openRecordingSource(deviceId, startupSignal, profile);
      return await recordVideoStream(source, filePath, fileName, startupSignal);
    } catch (error) {
      signal?.throwIfAborted();
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(`${profile.label}：${detail}`);
      // 仅编码/视频流启动异常才降级，ADB、磁盘、服务端版本错误直接保留原错误。
      if (!/录屏视频流|关键帧|codec|encod|capture|timeout|timed out/i.test(detail)) throw error;
      onLog?.(`录屏启动失败：${failures.at(-1)}`);
    }
  }
  throw new Error(`录屏兼容重试失败，尚未执行流程节点。请检查设备编码器或其他录屏占用。\n${failures.join('\n')}`);
}

// 独立于连接层，便于用真实 H.264 数据验证封装、断流和终止收尾。
export async function recordVideoStream(source: Awaited<ReturnType<typeof openRecordingSource>>, filePath: string, fileName: string, startupSignal: AbortSignal) {
  const writer = new ReplayVideoSegments(filePath, fileName);
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
      for (const segment of writer.segments) {
        if (!await isFinalizedMp4(segment.filePath)) throw new Error('录屏未生成完整 MP4');
      }
      return { ...writer.segments[0]!, segments: writer.segments, warning };
    } catch (error) {
      await writer.cancel().catch(() => undefined);
      if (writer.segments.length) return { ...writer.segments[0]!, segments: writer.segments, warning: `部分录像保存失败：${String(error)}` };
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
    return {
      startedAt: new Date(writer.startedAt).toISOString(), stop,
      selectScript: (id: string, name: string, force = false) => {
        if (stopping || warning) return Promise.reject(new Error(warning || '录屏已停止'));
        return writer.selectScript(id, name, force);
      },
    };
  } catch (error) {
    await stop().catch(() => undefined);
    await rm(filePath, { force: true });
    throw error;
  }
}

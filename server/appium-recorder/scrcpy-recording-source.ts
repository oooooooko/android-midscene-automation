import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { AdbServerClient, type Adb } from '@yume-chan/adb';
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp';
import { AdbScrcpyClient, AdbScrcpyOptions3_3_3 } from '@yume-chan/adb-scrcpy';
import { ScrcpyVideoCodecId } from '@yume-chan/scrcpy';
import { getAdbCommand } from '../android-sdk';

export function waitForVideoTask<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

function adbCommand(args: string[], signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    execFile(getAdbCommand(), args, { timeout: 10000, signal, windowsHide: true }, error => error ? reject(error) : resolve());
  });
}

export async function openRecordingSource(deviceId: string, signal: AbortSignal) {
  const require = createRequire(import.meta.url);
  const bin = join(dirname(require.resolve('@midscene/android-playground/package.json')), 'bin');
  const version = (await readFile(join(bin, 'scrcpy-server.version'), 'utf8')).trim();
  if (version !== 'v3.3.3') throw new Error(`内置 scrcpy 服务端版本不兼容：${version}`);
  const remotePath = `/data/local/tmp/midscene-recording-${randomUUID()}.jar`;
  let adb: Adb | undefined;
  let client: Awaited<ReturnType<typeof AdbScrcpyClient.start>> | undefined;
  let closing = false;
  let logs = '';
  let closeTask: Promise<void> | undefined;
  const close = () => closeTask ??= (async () => {
    closing = true;
    await waitForVideoTask(Promise.allSettled([client?.close(), adb?.close()]), AbortSignal.timeout(3000)).catch(() => undefined);
    await adbCommand(['-s', deviceId, 'shell', 'rm', '-f', remotePath]).catch(() => undefined);
  })();
  try {
    await adbCommand(['start-server'], signal);
    await adbCommand(['-s', deviceId, 'push', join(bin, 'scrcpy-server'), remotePath], signal);
    const server = new AdbServerClient(new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: 5037 }));
    adb = await waitForVideoTask(server.createAdb({ serial: deviceId }).then(connection => {
      if (closing || signal.aborted) { void connection.close(); throw signal.reason || new Error('录屏已取消'); }
      return connection;
    }), signal);
    // 独立 socket ID 和上传路径，停止录制不会关闭正在使用的设备预览。
    const options = new AdbScrcpyOptions3_3_3({
      scid: Math.floor(Math.random() * 0x7fffffff).toString(16).padStart(8, '0'),
      audio: false, control: false, videoCodec: 'h264', sendFrameMeta: true,
      maxSize: 1280, maxFps: 15, videoBitRate: 2000000,
      captureOrientation: '@', videoCodecOptions: 'profile=1,max-bframes=0,i-frame-interval=2',
    });
    client = await waitForVideoTask(AdbScrcpyClient.start(adb, remotePath, options).then(value => {
      if (closing || signal.aborted) { void value.close(); throw signal.reason || new Error('录屏已取消'); }
      return value;
    }), signal);
    // 持续消费服务端输出，避免输出管道阻塞编码进程。
    const outputReader = client.output.getReader();
    void (async () => {
      try {
        while (true) {
          const { done, value } = await outputReader.read();
          if (done) break;
          logs = `${logs}\n${value}`.slice(-4000);
        }
      } finally { outputReader.releaseLock(); }
    })().catch(() => undefined);
    const video = await waitForVideoTask(client.videoStream!, signal);
    if (video.metadata.codec !== ScrcpyVideoCodecId.H264) throw new Error('录屏需要 H.264 视频流');
    return { stream: video.stream, close, diagnostics: () => logs };
  } catch (error) {
    await close();
    throw error;
  }
}

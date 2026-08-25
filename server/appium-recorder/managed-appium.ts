import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';

type ManagedAppiumServer = {
  serverUrl: string;
  stop: () => Promise<void>;
};

function reserveLocalPort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (port) resolve(port);
        else reject(new Error('无法分配 Appium 服务端口'));
      });
    });
  });
}

function createLineForwarder(onLine: (line: string) => void) {
  let pending = '';
  return {
    write(chunk: Buffer | string) {
      pending += chunk.toString();
      const lines = pending.split(/\n/);
      pending = lines.pop() || '';
      lines.forEach((line) => onLine(line.replace(/\r$/, '')));
    },
    flush() {
      if (pending) onLine(pending.replace(/\r$/, ''));
      pending = '';
    },
  };
}

function wait(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(new Error('用户手动终止'));
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('用户手动终止'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForStatus(
  serverUrl: string,
  child: ChildProcessWithoutNullStreams,
  getProcessError: () => Error | null,
  signal?: AbortSignal,
) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('用户手动终止');
    const processError = getProcessError();
    if (processError) throw processError;
    if (child.exitCode !== null) throw new Error(`Appium 进程已退出，退出码：${child.exitCode}`);
    try {
      const response = await fetch(`${serverUrl}/status`, { signal: AbortSignal.timeout(800) });
      if (response.ok) return;
    } catch {
      // Appium 启动期间端口暂不可用，继续等待。
    }
    await wait(200, signal);
  }
  throw new Error('Appium 服务启动超时（30s）');
}

function terminateProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => undefined);
    return;
  }
  child.kill('SIGTERM');
}

export function usesManagedAppiumServer() {
  return !process.env.APPIUM_SERVER_URL?.trim();
}

export async function startManagedAppiumServer(
  onLine: (line: string) => void,
  signal?: AbortSignal,
): Promise<ManagedAppiumServer> {
  const port = await reserveLocalPort();
  const serverUrl = `http://127.0.0.1:${port}`;
  const executable = process.env.APPIUM_EXECUTABLE?.trim() || (process.platform === 'win32' ? 'appium.cmd' : 'appium');
  const args = [
    '--address',
    '127.0.0.1',
    '--port',
    String(port),
    '--log-level',
    'debug',
    '--log-no-colors',
    '--log-timestamp',
    '--local-timezone',
  ];
  const child = spawn(executable, args, {
    env: process.env,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stdout = createLineForwarder(onLine);
  const stderr = createLineForwarder(onLine);
  child.stdout.on('data', (chunk) => stdout.write(chunk));
  child.stderr.on('data', (chunk) => stderr.write(chunk));

  let processError: Error | null = null;
  child.once('error', (error) => {
    processError = error;
    onLine(`[Appium] 进程错误：${error.message}`);
  });
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });

  const stop = async () => {
    terminateProcess(child);
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
    if (child.exitCode === null && process.platform !== 'win32') child.kill('SIGKILL');
    stdout.flush();
    stderr.flush();
  };

  try {
    await waitForStatus(serverUrl, child, () => processError, signal);
    if (processError) throw processError;
    return { serverUrl, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

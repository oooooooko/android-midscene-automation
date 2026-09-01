// The Midscene Admin HTTP API — extracted from vite.config.ts so the exact
// same middleware serves the standalone dev/preview flow AND the DSH plugin.
// It is a Connect-style handler: (req, res, next). Callers that have no next
// stage (the DSH plugin) provide their own (e.g. static SPA serving).
import type { IncomingMessage, ServerResponse } from 'node:http';

type NextFunction = (err?: unknown) => void;
type NextHandleFunction = (req: IncomingMessage, res: ServerResponse, next: NextFunction) => void;

import { execFile, spawn } from 'node:child_process';
import { appPath } from './paths';
import { ConfigValidationError, loadConfig, saveConfig, type AppConfig } from './config';
import { listAppPresetRecords, removeAppPresetRecord, saveAppPresetRecord } from './config-store';
import { generatePlan } from './script-agent';
import { testModelConnection } from './model-tester';
import { DeviceLockConflictError } from './device-locks/types';
import { acquireDeviceLock, listActiveDeviceLocks, releaseDeviceLock } from './device-locks/service';
import { ensureDeviceSession, listDeviceSessions } from './device-sessions/service';
import {
  finishScriptRunOperation,
  getOperationWithEvents,
  listOperations,
  recordOperationEvent,
  startScriptRunOperation,
} from './operations/service';
import {
  checkGeneratedScriptExists,
  deleteGeneratedScript,
  runGeneratedScript,
  saveGeneratedScript,
  updateGeneratedScriptCode,
  validateGeneratedScriptCode,
  type RunGeneratedScriptEvent,
} from './script-runner';
import { listScriptRecords, type ScriptStepRecord } from './script-db';
import { importTestCaseFile, MAX_TEST_CASE_FILE_SIZE } from './test-case-import/service';
import { handleAppiumRecorderRequest } from './appium-recorder/routes';
import { handleRemoteAgentRequest } from './remote-agents/routes';
import { isRemoteDeviceId, listRemoteAndroidDevices, sendRemoteCommand } from './remote-agents/registry';
import { getAdbCommand } from './android-sdk';

async function readBody<T>(req: IncomingMessage) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  return await new Promise<T>((resolve) => {
    req.on('end', () => {
      resolve(JSON.parse(body || '{}') as T);
    });
  });
}

async function readRawBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  req.on('data', (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  return await new Promise<Buffer>((resolve) => {
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
  });
}

function execFileText(command: string, args: string[] = []) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

function execFileJson(command: string, args: string[] = []) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(command, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function writeNdjson(res: ServerResponse, event: RunGeneratedScriptEvent | { type: 'error'; message: string }) {
  res.write(`${JSON.stringify(event)}\n`);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Work around @midscene/android-playground v1.12.x ESM __dirname usage on Node 24.
const START_ANDROID_PLAYGROUND_WITHOUT_BROWSER = [
  "import { createRequire } from 'node:module';",
  'const require = createRequire(import.meta.url);',
  "const { androidPlaygroundPlatform, ScrcpyServer } = require('@midscene/android-playground');",
  "const { launchPreparedPlaygroundPlatform } = require('@midscene/playground');",
  'const STABLE_PREVIEW_OPTIONS = {',
  '  maxFps: 10,',
  '  maxSize: 800,',
  '  videoBitRate: 1000000,',
  '};',
  'async function main() {',
  '  const scrcpyServer = new ScrcpyServer();',
  '  const startScrcpy = scrcpyServer.startScrcpy.bind(scrcpyServer);',
  '  scrcpyServer.startScrcpy = (adb, options = {}, onProgress) => startScrcpy(adb, {',
  '    ...options,',
  '    ...STABLE_PREVIEW_OPTIONS,',
  '  }, onProgress);',
  '  const prepared = await androidPlaygroundPlatform.prepare({ scrcpyServer });',
  '  await launchPreparedPlaygroundPlatform(prepared);',
  '}',
  "main().catch((error) => {",
  "  console.error(error);",
  "  process.exit(1);",
  "});",
].join('\n');

type AndroidDevice = {
  id: string;
  status: string;
  description: string;
};

type AndroidDisplayInfo = {
  width: number;
  height: number;
};

async function listAdbDevices() {
  const output = await execFileText(getAdbCommand(), ['devices', '-l']);
  const devices = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices attached'))
    .map((line) => {
      const parts = line.split(/\s+/);
      const id = parts[0] || '';
      const status = parts[1] || 'unknown';
      const model = parts.find((part) => part.startsWith('model:'))?.slice(6) || '';
      const device = parts.find((part) => part.startsWith('device:'))?.slice(7) || '';
      return {
        id,
        status,
        description: [model, device].filter(Boolean).join(' · ') || status,
      } satisfies AndroidDevice;
    })
    .filter((device) => device.id);

  return devices;
}

async function getAdbDisplayInfo(deviceId: string) {
  const output = await execFileText(getAdbCommand(), ['-s', deviceId, 'shell', 'wm', 'size']);
  const match = output.match(/Override size:\s*(\d+)x(\d+)/i) || output.match(/Physical size:\s*(\d+)x(\d+)/i);

  if (!match) {
    throw new Error('读取设备分辨率失败');
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  } satisfies AndroidDisplayInfo;
}

function getRequestedDeviceId(req: IncomingMessage) {
  const url = new URL(req.url || '/', 'http://localhost');
  return url.searchParams.get('deviceId')?.trim() || '';
}

function getCookie(req: IncomingMessage, name: string) {
  const cookie = req.headers.cookie || '';
  return cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) || '';
}

function setCookie(res: ServerResponse, value: string) {
  const existing = res.getHeader('Set-Cookie');
  const next = `midscene_client_id=${value}; Path=/; SameSite=Lax`;
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, next]);
  } else if (existing) {
    res.setHeader('Set-Cookie', [String(existing), next]);
  } else {
    res.setHeader('Set-Cookie', next);
  }
}

function isLocalRequest(req: IncomingMessage) {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function assertDeviceAllowedForRequest(req: IncomingMessage, deviceId: string) {
  if (!isLocalRequest(req) && deviceId && !isRemoteDeviceId(deviceId)) {
    throw new Error('局域网访问者只能使用远程代理设备');
  }
}

async function resolvePlaygroundUrl(selectedDeviceId: string) {
  const ports = [5800, 5801, 5802, 5803, 5804, 5805];
  const candidates: Array<{
    url: string;
    previewKind: string;
    deviceId: string;
    sessionConnected: boolean;
    setupState: string;
    previewError: string;
    score: number;
  }> = [];

  for (const port of ports) {
    const url = `http://localhost:${port}`;
    try {
      const statusResponse = await fetch(`${url}/status`);
      if (!statusResponse.ok) {
        continue;
      }
      const [runtimeInfoResponse, screenshotResponse] = await Promise.all([
        fetch(`${url}/runtime-info`).catch(() => null),
        fetch(`${url}/screenshot`).catch(() => null),
      ]);
      const runtimeInfo = runtimeInfoResponse?.ok
        ? (await runtimeInfoResponse.json()) as {
            preview?: { kind?: string };
            metadata?: { deviceId?: string; sessionConnected?: boolean; setupState?: string };
          }
        : null;
      const screenshotPayload = await screenshotResponse?.json().catch(() => null) as
        | { error?: string }
        | null
        | undefined;
      const deviceId = runtimeInfo?.metadata?.deviceId || '';
      const sessionConnected = runtimeInfo?.metadata?.sessionConnected === true;
      const setupState = runtimeInfo?.metadata?.setupState || '';
      const previewError = screenshotResponse?.ok ? '' : screenshotPayload?.error || '';
      const matchesSelectedDevice = !selectedDeviceId || deviceId === selectedDeviceId;
      let score = 0;
      if (matchesSelectedDevice && selectedDeviceId) score += 4;
      if (!previewError) score += 2;
      if (runtimeInfo?.preview?.kind === 'scrcpy' && sessionConnected && matchesSelectedDevice) score += 4;
      candidates.push({
        url,
        previewKind: runtimeInfo?.preview?.kind || '',
        deviceId,
        sessionConnected,
        setupState,
        previewError,
        score,
      });
    } catch {
      // Ignore unavailable ports.
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

type PlaygroundTarget = Awaited<ReturnType<typeof resolvePlaygroundUrl>>;

function isUsablePlaygroundTarget(target: PlaygroundTarget, selectedDeviceId: string) {
  if (!target) return false;
  const matchesSelectedDevice = !selectedDeviceId || target.deviceId === selectedDeviceId;
  return target.previewKind === 'scrcpy' && target.sessionConnected && matchesSelectedDevice;
}

async function createPlaygroundSession(target: PlaygroundTarget, selectedDeviceId: string) {
  if (!target || !selectedDeviceId) return null;
  const response = await fetch(`${target.url}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: selectedDeviceId }),
  });
  if (!response.ok) {
    return null;
  }
  return await resolvePlaygroundUrl(selectedDeviceId);
}

const PLAYGROUND_FRAME_PREFIX = '/__android_playground__';
const PLAYGROUND_PROXY_PREFIXES = [
  '/status',
  '/runtime-info',
  '/interface-info',
  '/screenshot',
  '/action-space',
  '/execute',
  '/interact',
  '/config',
  '/connectivity-test',
  '/task-progress',
  '/session',
  '/recorder',
  '/cancel',
  '/mjpeg',
] as const;

function isPlaygroundProxyPath(pathname: string) {
  if (pathname === PLAYGROUND_FRAME_PREFIX || pathname === `${PLAYGROUND_FRAME_PREFIX}/`) {
    return true;
  }

  if (pathname.startsWith(`${PLAYGROUND_FRAME_PREFIX}/`)) {
    return true;
  }

  return PLAYGROUND_PROXY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function buildPlaygroundChromeCss() {
  return `
html, body, #root {
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  background: #ffffff !important;
}
body {
  background: #ffffff !important;
}
.app-container,
.playground-container,
.app-content,
.app-content > * {
  width: 100% !important;
  height: 100% !important;
  min-height: 0 !important;
  background: #ffffff !important;
}
.app-panel.left-panel,
.panel-resize-handle,
.playground-panel-header,
.player-container .control-bar,
.player-container .player-subtitle,
.screenshot-viewer .screenshot-header,
.screenshot-viewer .screenshot-overlay {
  display: none !important;
}
.app-panel.right-panel {
  flex: 1 1 auto !important;
  width: 100% !important;
  padding-top: 0 !important;
  box-shadow: none !important;
  border-radius: 0 !important;
}
.panel-content.right-panel-content {
  height: 100% !important;
  padding: 0 !important;
  overflow: hidden !important;
}
.player-container,
.result-wrapper,
.result-wrapper .player-container,
.screenshot-viewer,
.screenshot-viewer .screenshot-container,
.screenshot-viewer.screen-only > .screenshot-content {
  width: 100% !important;
  height: 100% !important;
  min-height: 0 !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: #ffffff !important;
  overflow: hidden !important;
}
.player-container .canvas-container,
.result-wrapper .player-container .canvas-container,
.screenshot-viewer .screenshot-content,
.screenshot-viewer .screenshot-image {
  width: 100% !important;
  height: 100% !important;
  min-height: 0 !important;
  max-height: none !important;
  border-radius: 0 !important;
}
.player-container .canvas-container {
  background: #ffffff !important;
}
.player-container .canvas-container .player-wrapper {
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
}
.player-container canvas,
.player-container video {
  width: 100% !important;
  height: 100% !important;
  object-fit: contain !important;
}
`;
}

function rewritePlaygroundHtml(html: string) {
  const injectedStyle = `<style id="midscene-admin-playground-skin">${buildPlaygroundChromeCss()}</style>`;
  let next = html
    .replace(/(href|src)="\/static\//g, `$1="${PLAYGROUND_FRAME_PREFIX}/static/`)
    .replace(/window\.SCRCPY_PORT\s*=\s*(\d+);/, `window.SCRCPY_PORT = $1;`);

  if (next.includes('</head>')) {
    next = next.replace('</head>', `${injectedStyle}</head>`);
  } else {
    next = `${injectedStyle}${next}`;
  }

  return next;
}

async function proxyPlaygroundRequest(req: IncomingMessage, res: ServerResponse, selectedDeviceId: string) {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const target = await resolvePlaygroundUrl(selectedDeviceId);

  if (!target) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ message: '未检测到可用的 Android Playground 实例' }));
    return;
  }

  let targetPath = requestUrl.pathname;
  if (targetPath === PLAYGROUND_FRAME_PREFIX || targetPath === `${PLAYGROUND_FRAME_PREFIX}/`) {
    targetPath = '/';
  } else if (targetPath.startsWith(`${PLAYGROUND_FRAME_PREFIX}/`)) {
    targetPath = targetPath.slice(PLAYGROUND_FRAME_PREFIX.length);
  }

  const targetUrl = new URL(targetPath + requestUrl.search, target.url);
  const headers = new Headers();

  Object.entries(req.headers).forEach(([key, value]) => {
    if (!value || key === 'host' || key === 'content-length') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(key, item));
      return;
    }
    headers.set(key, String(value));
  });

  const method = req.method || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readRawBody(req);
  const response = await fetch(targetUrl, {
    method,
    headers,
    body,
  });

  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key === 'content-length') {
      return;
    }
    res.setHeader(key, value);
  });

  if (targetPath === '/' && response.headers.get('content-type')?.includes('text/html')) {
    const html = await response.text();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(rewritePlaygroundHtml(html));
    return;
  }

  if (targetPath === '/mjpeg' && response.body) {
    const reader = response.body.getReader();
    req.once('close', () => {
      reader.cancel().catch(() => undefined);
    });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) res.write(Buffer.from(value));
      }
      res.end();
    } catch {
      if (!res.writableEnded) res.end();
    }
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

export function createApiMiddleware() {
  const selectedDeviceByClient = new Map<string, string>();
  let playgroundProcess: ReturnType<typeof spawn> | null = null;
  let playgroundEnsurePromise: Promise<unknown> | null = null;
  let lastPlaygroundEnsureAt = 0;
  let lastPlaygroundEnsureDeviceId = '';
  let activeScriptAbortController: AbortController | null = null;

  const getClientId = (req: IncomingMessage, res: ServerResponse) => {
    const existing = getCookie(req, 'midscene_client_id');
    if (existing) return existing;
    const next = `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    setCookie(res, next);
    return next;
  };

  const getSelectedDeviceId = (req: IncomingMessage, res: ServerResponse) => {
    return selectedDeviceByClient.get(getClientId(req, res)) || '';
  };

  const setSelectedDeviceId = (req: IncomingMessage, res: ServerResponse, deviceId: string) => {
    selectedDeviceByClient.set(getClientId(req, res), deviceId);
  };

  const listVisibleAndroidDevices = async (req: IncomingMessage) => {
    const localDevices = isLocalRequest(req) ? await listAdbDevices() : [];
    return [...localDevices, ...listRemoteAndroidDevices()];
  };

  const ensureAndroidPlayground = async (selectedDeviceId: string) => {
    const existing = await resolvePlaygroundUrl(selectedDeviceId);
    if (isUsablePlaygroundTarget(existing, selectedDeviceId)) {
      return { target: existing, started: false, skippedReason: '' };
    }
    if (existing && selectedDeviceId && !existing.sessionConnected) {
      const created = await createPlaygroundSession(existing, selectedDeviceId);
      if (isUsablePlaygroundTarget(created, selectedDeviceId)) {
        return { target: created, started: false, skippedReason: '' };
      }
    }
    if (existing?.sessionConnected) {
      return {
        target: null,
        started: false,
        skippedReason: '已有 Android Playground 实例连接到其他设备',
      };
    }
    if (playgroundProcess && !playgroundProcess.killed) {
      return {
        target: null,
        started: false,
        skippedReason: 'Android Playground 正在启动中',
      };
    }

    playgroundProcess = spawn(process.execPath, ['--input-type=module', '--eval', START_ANDROID_PLAYGROUND_WITHOUT_BROWSER], {
      cwd: appPath(),
      env: {
        ...process.env,
        ...(selectedDeviceId ? { ANDROID_SERIAL: selectedDeviceId } : {}),
      },
      stdio: 'ignore',
      detached: false,
    });
    playgroundProcess.once('error', (error) => {
      console.warn(`Android Playground 启动失败：${error.message}`);
      playgroundProcess = null;
    });
    playgroundProcess.once('exit', () => {
      playgroundProcess = null;
    });

    return { target: null, started: true, skippedReason: '' };
  };

  const ensureAndroidPlaygroundInBackground = (selectedDeviceId: string) => {
    if (!selectedDeviceId) return;
    if (isRemoteDeviceId(selectedDeviceId)) return;
    const now = Date.now();
    if (
      playgroundEnsurePromise ||
      (lastPlaygroundEnsureDeviceId === selectedDeviceId && now - lastPlaygroundEnsureAt < 10000)
    ) {
      return;
    }

    lastPlaygroundEnsureAt = now;
    lastPlaygroundEnsureDeviceId = selectedDeviceId;
    playgroundEnsurePromise = ensureAndroidPlayground(selectedDeviceId)
      .catch(() => undefined)
      .finally(() => {
        playgroundEnsurePromise = null;
      });
  };

  const stopAndroidPlayground = async () => {
    const processToStop = playgroundProcess;
    if (!processToStop || processToStop.killed) return;

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 1500);
      processToStop.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      processToStop.kill('SIGTERM');
    });
    if (playgroundProcess === processToStop) {
      playgroundProcess = null;
    }
  };

  const waitForUsablePlaygroundTarget = async (selectedDeviceId: string, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    let resolved: PlaygroundTarget = null;
    while (Date.now() < deadline) {
      resolved = await resolvePlaygroundUrl(selectedDeviceId);
      if (resolved && selectedDeviceId && !isUsablePlaygroundTarget(resolved, selectedDeviceId) && !resolved.sessionConnected) {
        resolved = await createPlaygroundSession(resolved, selectedDeviceId) || resolved;
      }
      if (isUsablePlaygroundTarget(resolved, selectedDeviceId)) {
        return resolved;
      }
      await delay(500);
    }
    return resolved;
  };

  const handler: NextHandleFunction = async (req, res, next) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = requestUrl.pathname;
    const allowLocalDevice = isLocalRequest(req);
    let selectedDeviceId = getSelectedDeviceId(req, res);
    if (!allowLocalDevice && selectedDeviceId && !isRemoteDeviceId(selectedDeviceId)) {
      selectedDeviceId = '';
      setSelectedDeviceId(req, res, selectedDeviceId);
    }

    if (isPlaygroundProxyPath(pathname)) {
      try {
        await proxyPlaygroundRequest(req, res, selectedDeviceId);
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Playground 代理失败' }));
      }
      return;
    }

    if (await handleRemoteAgentRequest(req, res)) {
      return;
    }

    if (await handleAppiumRecorderRequest(req, res, selectedDeviceId, allowLocalDevice)) {
      return;
    }

    if (req.url?.startsWith('/api/device-sessions') && req.method === 'GET') {
      try {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ sessions: listDeviceSessions() }));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : '读取设备会话失败' }));
      }
      return;
    }

    if (req.url?.startsWith('/api/device-locks') && req.method === 'GET') {
      try {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ locks: listActiveDeviceLocks() }));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : '读取设备锁失败' }));
      }
      return;
    }

    if (req.url?.startsWith('/api/operations') && req.method === 'GET') {
      try {
        const requestUrl = new URL(req.url || '/', 'http://localhost');
        const operationId = requestUrl.pathname.split('/').filter(Boolean)[2] || '';
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (operationId) {
          const detail = getOperationWithEvents(operationId);
          if (!detail) {
            res.statusCode = 404;
            res.end(JSON.stringify({ message: '执行记录不存在' }));
            return;
          }
          res.end(JSON.stringify(detail));
          return;
        }
        const limit = Number(requestUrl.searchParams.get('limit') || 30);
        res.end(JSON.stringify({ operations: listOperations(limit) }));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : '读取执行记录失败' }));
      }
      return;
    }

    if (req.url === '/api/config' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(loadConfig()));
      return;
    }

    if (req.url === '/api/config' && req.method === 'POST') {
      try {
        const config = await readBody<AppConfig>(req);
        saveConfig(config);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.statusCode = error instanceof ConfigValidationError ? 400 : 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Unknown error' }));
      }
      return;
    }

    if (req.url?.startsWith('/api/android-devices') && req.method === 'GET') {
      try {
        const devices = await listVisibleAndroidDevices(req);
        const onlineDevices = devices.filter((device) => device.status === 'device');
        if (!onlineDevices.some((device) => device.id === selectedDeviceId)) {
          selectedDeviceId = onlineDevices[0]?.id || devices[0]?.id || '';
          setSelectedDeviceId(req, res, selectedDeviceId);
        }
        if (selectedDeviceId) {
          ensureDeviceSession({ deviceId: selectedDeviceId });
        }
        if (!isRemoteDeviceId(selectedDeviceId)) {
          ensureAndroidPlaygroundInBackground(selectedDeviceId);
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ devices, currentDeviceId: selectedDeviceId }));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Unknown error' }));
      }
      return;
    }

    if (req.url === '/api/android-device' && req.method === 'POST') {
      try {
        const parsed = await readBody<{ deviceId?: string }>(req);
        const devices = await listVisibleAndroidDevices(req);
        const exists = devices.some((device) => device.id === parsed.deviceId);
        if (!exists) {
          throw new Error('设备不存在或已断开');
        }
        selectedDeviceId = parsed.deviceId || '';
        setSelectedDeviceId(req, res, selectedDeviceId);
        ensureDeviceSession({ deviceId: selectedDeviceId });
        lastPlaygroundEnsureDeviceId = '';
        if (!isRemoteDeviceId(selectedDeviceId)) {
          ensureAndroidPlaygroundInBackground(selectedDeviceId);
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ success: true, currentDeviceId: selectedDeviceId }));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Unknown error' }));
      }
      return;
    }

    if (req.url?.startsWith('/api/android-preview') && req.method === 'GET') {
      try {
        const deviceId = getRequestedDeviceId(req) || selectedDeviceId;
        if (!deviceId) {
          throw new Error('未检测到可用设备');
        }
        assertDeviceAllowedForRequest(req, deviceId);

        if (isRemoteDeviceId(deviceId)) {
          const data = await sendRemoteCommand(deviceId, 'screenshot') as { base64?: string };
          if (!data.base64) throw new Error('远程设备预览不可用');
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'no-store');
          res.end(Buffer.from(data.base64, 'base64'));
          return;
        }

        execFile(getAdbCommand(), ['-s', deviceId, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ message: stderr || error.message || '设备预览不可用' }));
            return;
          }
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'no-store');
          res.end(stdout);
        });
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Unknown error' }));
      }
      return;
    }

    if (req.url === '/api/android-tap' && req.method === 'POST') {
      try {
        const parsed = await readBody<{ deviceId?: string; x?: number; y?: number }>(req);
        const deviceId = parsed.deviceId || selectedDeviceId;
        const x = Math.round(Number(parsed.x));
        const y = Math.round(Number(parsed.y));
        if (!deviceId) {
          throw new Error('未检测到可用设备');
        }
        assertDeviceAllowedForRequest(req, deviceId);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new Error('点击坐标无效');
        }
        if (isRemoteDeviceId(deviceId)) {
          const result = await sendRemoteCommand(deviceId, 'tap', { x, y });
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ success: true, result }));
          return;
        }
        const result = await execFileJson(getAdbCommand(), ['-s', deviceId, 'shell', 'input', 'tap', String(x), String(y)]);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Unknown error' }));
      }
      return;
    }

    if (req.url === '/api/android-keyevent' && req.method === 'POST') {
      try {
        const parsed = await readBody<{ deviceId?: string; keyCode?: number }>(req);
        const deviceId = parsed.deviceId || selectedDeviceId;
        const keyCode = Math.round(Number(parsed.keyCode));
        if (!deviceId) {
          throw new Error('未检测到可用设备');
        }
        assertDeviceAllowedForRequest(req, deviceId);
        if (!Number.isFinite(keyCode)) {
          throw new Error('按键无效');
        }
        if (isRemoteDeviceId(deviceId)) {
          const result = await sendRemoteCommand(deviceId, 'key', { keyCode });
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ success: true, result }));
          return;
        }
        const result = await execFileJson(getAdbCommand(), ['-s', deviceId, 'shell', 'input', 'keyevent', String(keyCode)]);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Unknown error' }));
      }
      return;
    }

    if (req.url?.startsWith('/api/android-display-info') && req.method === 'GET') {
      try {
        const deviceId = getRequestedDeviceId(req) || selectedDeviceId;
        if (!deviceId) {
          throw new Error('未检测到可用设备');
        }
        assertDeviceAllowedForRequest(req, deviceId);
        if (isRemoteDeviceId(deviceId)) {
          const displayInfo = await sendRemoteCommand(deviceId, 'displayInfo') as AndroidDisplayInfo;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ deviceId, ...displayInfo }));
          return;
        }
        const displayInfo = await getAdbDisplayInfo(deviceId);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ deviceId, ...displayInfo }));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Unknown error' }));
      }
      return;
    }

    if (req.url === '/api/android-swipe' && req.method === 'POST') {
      try {
        const parsed = await readBody<{
          deviceId?: string;
          startX?: number;
          startY?: number;
          endX?: number;
          endY?: number;
          duration?: number;
        }>(req);
        const deviceId = parsed.deviceId || selectedDeviceId;
        const startX = Math.round(Number(parsed.startX));
        const startY = Math.round(Number(parsed.startY));
        const endX = Math.round(Number(parsed.endX));
        const endY = Math.round(Number(parsed.endY));
        const duration = Math.max(80, Math.round(Number(parsed.duration) || 160));
        if (!deviceId) {
          throw new Error('未检测到可用设备');
        }
        assertDeviceAllowedForRequest(req, deviceId);
        if (![startX, startY, endX, endY].every(Number.isFinite)) {
          throw new Error('滑动坐标无效');
        }
        if (isRemoteDeviceId(deviceId)) {
          const result = await sendRemoteCommand(deviceId, 'swipe', { startX, startY, endX, endY, duration });
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ success: true, result }));
          return;
        }
        const result = await execFileJson(
          getAdbCommand(),
          ['-s', deviceId, 'shell', 'input', 'swipe', String(startX), String(startY), String(endX), String(endY), String(duration)],
        );
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Unknown error' }));
      }
      return;
    }

    if (req.url === '/api/playground-status' && req.method === 'GET') {
      try {
        if (selectedDeviceId && isRemoteDeviceId(selectedDeviceId)) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            available: false,
            url: '',
            previewKind: '',
            deviceId: selectedDeviceId,
            sessionConnected: false,
            setupState: 'remote-device',
            previewError: '',
          }));
          return;
        }
        let resolved = await resolvePlaygroundUrl(selectedDeviceId);
        if (resolved && selectedDeviceId && !isUsablePlaygroundTarget(resolved, selectedDeviceId) && !resolved.sessionConnected) {
          resolved = await createPlaygroundSession(resolved, selectedDeviceId) || resolved;
        }
        const available = isUsablePlaygroundTarget(resolved, selectedDeviceId);
        if (selectedDeviceId) {
          ensureDeviceSession({
            deviceId: selectedDeviceId,
            patch: {
              playgroundUrl: resolved?.url || '',
              previewKind: resolved?.previewKind || '',
              sessionConnected: resolved?.sessionConnected || false,
              setupState: resolved?.setupState || '',
              previewError: resolved?.previewError || '',
            },
          });
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            available,
            url: resolved?.url || '',
            previewKind: resolved?.previewKind || '',
            deviceId: resolved?.deviceId || '',
            sessionConnected: resolved?.sessionConnected || false,
            setupState: resolved?.setupState || '',
            previewError: resolved?.previewError || '',
          }),
        );
      } catch {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ available: false, url: '', previewKind: '', deviceId: '', sessionConnected: false, setupState: '', previewError: '' }));
      }
      return;
    }

    if (req.url === '/api/playground-ensure' && req.method === 'POST') {
      try {
        const result = await ensureAndroidPlayground(selectedDeviceId);
        if (selectedDeviceId) {
          ensureDeviceSession({
            deviceId: selectedDeviceId,
            patch: {
              playgroundUrl: result.target?.url || '',
              previewKind: result.target?.previewKind || '',
              sessionConnected: result.target?.sessionConnected || false,
              setupState: result.target?.setupState || result.skippedReason || '',
              previewError: result.target?.previewError || '',
            },
          });
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          started: result.started,
          available: !!result.target,
          url: result.target?.url || '',
          skippedReason: result.skippedReason,
        }));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : '启动 Android Playground 失败' }));
      }
      return;
    }

    if (req.url === '/api/playground-restart' && req.method === 'POST') {
      try {
        const payload = await readBody<{ deviceId?: string }>(req);
        const deviceId = payload.deviceId || selectedDeviceId;
        if (!deviceId) {
          throw new Error('请先选择 Android 设备');
        }
        if (isRemoteDeviceId(deviceId)) {
          throw new Error('远程设备不支持重启本地实时预览');
        }

        setSelectedDeviceId(req, res, deviceId);
        selectedDeviceId = deviceId;
        playgroundEnsurePromise = null;
        lastPlaygroundEnsureAt = 0;
        lastPlaygroundEnsureDeviceId = '';
        await stopAndroidPlayground();
        const result = await ensureAndroidPlayground(deviceId);
        const target = result.target || await waitForUsablePlaygroundTarget(deviceId);

        ensureDeviceSession({
          deviceId,
          patch: {
            playgroundUrl: target?.url || '',
            previewKind: target?.previewKind || '',
            sessionConnected: target?.sessionConnected || false,
            setupState: target?.setupState || result.skippedReason || '',
            previewError: target?.previewError || '',
          },
        });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          success: true,
          started: result.started,
          available: isUsablePlaygroundTarget(target, deviceId),
          url: target?.url || '',
          skippedReason: result.skippedReason,
        }));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : '重启 Android Playground 失败' }));
      }
      return;
    }

    if (req.url === '/api/test-model' && req.method === 'POST') {
      try {
        const parsed = await readBody<{
          modelKey?: 'midscene' | 'scriptOptimizer';
          model?: {
            provider?: 'custom' | 'codex';
            baseUrl?: string;
            apiKey?: string;
            name?: string;
            family?: string;
          };
        }>(req);
        const model = parsed.model || {};

        const result = await testModelConnection({
          provider: model.provider,
          baseUrl: model.baseUrl || '',
          apiKey: model.apiKey || '',
          name: model.name || '',
          family: model.family || '',
        });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Unknown error' }));
      }
      return;
    }

    if (req.url === '/api/app-presets' && req.method === 'GET') {
      try {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ apps: listAppPresetRecords() }));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Unknown error' }));
      }
      return;
    }

    if (req.url === '/api/save-app-preset' && req.method === 'POST') {
      try {
        const parsed = await readBody<{ id?: string; name?: string; packageName?: string }>(req);
        const app = saveAppPresetRecord({
          id: parsed.id,
          name: parsed.name || '',
          packageName: parsed.packageName || '',
        });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ app }));
      } catch (error) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : '保存 App 配置失败' }));
      }
      return;
    }

    if (req.url === '/api/delete-app-preset' && req.method === 'POST') {
      try {
        const parsed = await readBody<{ id?: string }>(req);
        if (!parsed.id) throw new Error('App ID 不能为空');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(removeAppPresetRecord(parsed.id)));
      } catch (error) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : '删除 App 配置失败' }));
      }
      return;
    }

    if (req.url === '/api/check-script' && req.method === 'POST') {
      try {
        const parsed = await readBody<{ scriptName?: string }>(req);
        const result = checkGeneratedScriptExists({
          scriptName: parsed.scriptName || 'generated-script',
        });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Unknown error' }));
      }
      return;
    }

    if (pathname === '/api/import-test-case' && req.method === 'POST') {
      try {
        const contentLength = Number(req.headers['content-length'] || 0);
        if (contentLength > MAX_TEST_CASE_FILE_SIZE) {
          throw new Error('文件大小不能超过 10MB');
        }
        const fileName = requestUrl.searchParams.get('fileName') || '';
        const buffer = await readRawBody(req);
        const result = await importTestCaseFile({ fileName, buffer });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result));
      } catch (error) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : '测试用例文件解析失败' }));
      }
      return;
    }

    if (req.url === '/api/validate-script-code' && req.method === 'POST') {
      try {
        const parsed = await readBody<{ code?: string }>(req);
        validateGeneratedScriptCode(parsed.code || '');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ valid: true }));
      } catch (error) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : '代码格式错误' }));
      }
      return;
    }

    if (req.url === '/api/scripts' && req.method === 'GET') {
      try {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ scripts: listScriptRecords() }));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Unknown error' }));
      }
      return;
    }

    if (req.url === '/api/delete-script' && req.method === 'POST') {
      try {
        const parsed = await readBody<{ id?: string }>(req);
        if (!parsed.id) {
          throw new Error('脚本 ID 不能为空');
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(deleteGeneratedScript({ id: parsed.id })));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Unknown error' }));
      }
      return;
    }

    if (req.url === '/api/update-script-code' && req.method === 'POST') {
      try {
        const parsed = await readBody<{ id?: string; code?: string }>(req);
        if (!parsed.id) {
          throw new Error('脚本 ID 不能为空');
        }
        const result = updateGeneratedScriptCode({
          id: parsed.id,
          code: parsed.code || '',
        });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result));
      } catch (error) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: error instanceof Error ? error.message : '保存代码失败' }));
      }
      return;
    }

    if (
      req.url !== '/api/generate' &&
      req.url !== '/api/run-script' &&
      req.url !== '/api/stop-script' &&
      req.url !== '/api/save-script'
    ) {
      next();
      return;
    }

    try {
      if (req.url === '/api/generate' && req.method === 'POST') {
        const parsed = await readBody<{
          prompt?: string;
        }>(req);
        const generateAbortController = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) {
            generateAbortController.abort();
          }
        });

        const result = await generatePlan({
          prompt: parsed.prompt || '',
          signal: generateAbortController.signal,
        });

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result));
        return;
      }

      if (req.url === '/api/run-script' && req.method === 'POST') {
        const parsed = await readBody<{
          code?: string;
          scriptName?: string;
          deviceId?: string;
          steps?: ScriptStepRecord[];
        }>(req);
        const deviceId = parsed.deviceId || selectedDeviceId;
        const scriptName = parsed.scriptName || 'generated-script';
        if (!deviceId) {
          throw new Error('未检测到可用设备');
        }

        const deviceSession = ensureDeviceSession({ deviceId });
        const operation = startScriptRunOperation({
          scriptName,
          deviceId,
          sessionId: deviceSession.id,
          request: {
            scriptName,
            deviceId,
            stepCount: Array.isArray(parsed.steps) ? parsed.steps.length : 0,
          },
        });

        try {
          acquireDeviceLock({
            deviceId,
            ownerType: 'script_run',
            ownerId: operation.id,
            metadata: {
              scriptName,
              sessionId: deviceSession.id,
            },
          });
        } catch (error) {
          if (error instanceof DeviceLockConflictError) {
            finishScriptRunOperation({
              operationId: operation.id,
              status: 'failed',
              errorMessage: error.message,
              result: {
                conflict: error.conflict,
              },
            });
            res.statusCode = 409;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ message: error.message, conflict: error.conflict, operation }));
            return;
          }
          throw error;
        }

        const runAbortController = new AbortController();
        activeScriptAbortController = runAbortController;
        res.on('close', () => {
          if (!res.writableEnded) {
            runAbortController.abort();
          }
        });

        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        writeNdjson(res, { type: 'operation', operation });

        try {
          const result = await runGeneratedScript({
            code: parsed.code || '',
            scriptName,
            deviceId,
            steps: parsed.steps || [],
            signal: runAbortController.signal,
            onEvent: (event) => {
              if (event.type === 'output') {
                recordOperationEvent({
                  operationId: operation.id,
                  eventType: 'output',
                  message: event.chunk,
                });
              } else if (event.type === 'step') {
                recordOperationEvent({
                  operationId: operation.id,
                  eventType: `step_${event.status}`,
                  message: event.title || '',
                  data: event,
                });
              } else if (event.type === 'done') {
                recordOperationEvent({
                  operationId: operation.id,
                  eventType: 'script_done',
                  data: {
                    success: event.success,
                    filePath: event.filePath,
                  },
                });
              }
              writeNdjson(res, event);
            },
          });
          finishScriptRunOperation({
            operationId: operation.id,
            status: result.success ? 'succeeded' : runAbortController.signal.aborted ? 'cancelled' : 'failed',
            output: result.output,
            filePath: result.filePath,
            result: {
              success: result.success,
            },
          });
        } catch (error) {
          finishScriptRunOperation({
            operationId: operation.id,
            status: runAbortController.signal.aborted ? 'cancelled' : 'failed',
            errorMessage: error instanceof Error ? error.message : '执行失败',
          });
          writeNdjson(res, {
            type: 'error',
            message: error instanceof Error ? error.message : '执行失败',
          });
        } finally {
          releaseDeviceLock(operation.id);
          if (activeScriptAbortController === runAbortController) {
            activeScriptAbortController = null;
          }
        }
        res.end();
        return;
      }

      if (req.url === '/api/stop-script' && req.method === 'POST') {
        const hadActiveRun = Boolean(activeScriptAbortController);
        activeScriptAbortController?.abort();
        activeScriptAbortController = null;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ success: true, stopped: hadActiveRun }));
        return;
      }

      if (req.url === '/api/save-script' && req.method === 'POST') {
        const parsed = await readBody<{
          code?: string;
          scriptName?: string;
          promptTitle?: string;
          sourcePrompt?: string;
          steps?: ScriptStepRecord[];
        }>(req);
        const result = saveGeneratedScript({
          code: parsed.code || '',
          scriptName: parsed.scriptName || 'generated-script',
          promptTitle: parsed.promptTitle || '',
          sourcePrompt: parsed.sourcePrompt || '',
          steps: Array.isArray(parsed.steps) ? parsed.steps : [],
        });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result));
        return;
      }
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Unknown error' }));
    }
  };

  return handler;
}

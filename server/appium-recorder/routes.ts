import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  deleteAppiumRecordedScript,
  getAppiumRecordedScript,
  importAppiumRecordedScript,
  listAppiumRecordedScripts,
  saveAppiumRecordedScript,
  type AppiumRecordedStepRecord,
} from './repository';
import { clearAppDataOnDevice, launchAppOnDevice, replayAppiumScript } from './appium-runner';
import { isRemoteDeviceId, sendRemoteCommand } from '../remote-agents/registry';
import { getAdbCommand } from '../android-sdk';

const treeDumpTasks = new Map<string, Promise<string>>();
const replayingDevices = new Set<string>();
const replayAbortControllers = new Map<string, AbortController>();

function sendJson(res: ServerResponse, payload: unknown, statusCode = 200) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendJsonDownload(res: ServerResponse, payload: unknown, fileName: string) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="appium-script.json"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.end(JSON.stringify(payload, null, 2));
}

function sendStreamEvent(res: ServerResponse, payload: unknown) {
  res.write(`${JSON.stringify(payload)}\n`);
}

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

function execFileText(command: string, args: string[] = []) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function dumpWindowHierarchy(deviceId: string) {
  const activeTask = treeDumpTasks.get(deviceId);
  if (activeTask) return activeTask;

  const task = (async () => {
    const localPath = path.join(os.tmpdir(), `midscene-appium-${deviceId.replace(/[^\w.-]/g, '_')}-${Date.now()}.xml`);
    const remotePath = '/data/local/tmp/midscene_appium_uidump.xml';
    await execFileText(getAdbCommand(), ['-s', deviceId, 'shell', 'uiautomator', 'dump', remotePath]);
    await execFileText(getAdbCommand(), ['-s', deviceId, 'pull', remotePath, localPath]);
    try {
      return await fs.readFile(localPath, 'utf8');
    } finally {
      await fs.unlink(localPath).catch(() => undefined);
    }
  })();
  treeDumpTasks.set(deviceId, task);
  try {
    return await task;
  } finally {
    if (treeDumpTasks.get(deviceId) === task) treeDumpTasks.delete(deviceId);
  }
}

async function getCurrentActivity(deviceId: string) {
  const output = await execFileText(getAdbCommand(), ['-s', deviceId, 'shell', 'dumpsys', 'activity', 'activities']);
  const resumedLine = output
    .split(/\r?\n/)
    .find((line) => /(?:topResumedActivity|ResumedActivity|mResumedActivity)/.test(line));
  return resumedLine?.match(/\s([\w.$]+\/[\w.$]+)\s/)?.[1] || '';
}

async function tapDevice(deviceId: string, x: number, y: number) {
  await execFileText(getAdbCommand(), [
    '-s',
    deviceId,
    'shell',
    'input',
    'tap',
    String(Math.round(x)),
    String(Math.round(y)),
  ]);
}

async function pressDeviceKey(deviceId: string, keyCode: number) {
  await execFileText(getAdbCommand(), [
    '-s',
    deviceId,
    'shell',
    'input',
    'keyevent',
    String(Math.round(keyCode)),
  ]);
}

export async function handleAppiumRecorderRequest(
  req: IncomingMessage,
  res: ServerResponse,
  selectedDeviceId: string,
  allowLocalDevice = true,
) {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const pathname = requestUrl.pathname;
  if (!pathname.startsWith('/api/appium-recorder')) {
    return false;
  }

  try {
    const assertDeviceAllowed = (deviceId: string) => {
      if (!allowLocalDevice && deviceId && !isRemoteDeviceId(deviceId)) {
        throw new Error('局域网访问者只能使用远程代理设备');
      }
    };

    if (pathname === '/api/appium-recorder/tree' && req.method === 'GET') {
      const deviceId = requestUrl.searchParams.get('deviceId')?.trim() || selectedDeviceId;
      if (!deviceId) throw new Error('未检测到可用设备');
      assertDeviceAllowed(deviceId);
      if (replayingDevices.has(deviceId)) {
        sendJson(res, { message: '回放期间已暂停组件树刷新' }, 409);
        return true;
      }
      if (isRemoteDeviceId(deviceId)) {
        const data = await sendRemoteCommand(deviceId, 'tree') as { xml?: string; activity?: string; dumpedAt?: string };
        sendJson(res, {
          deviceId,
          xml: data.xml || '',
          activity: data.activity || '',
          dumpedAt: data.dumpedAt || new Date().toISOString(),
        });
        return true;
      }
      const [xml, activity] = await Promise.all([
        dumpWindowHierarchy(deviceId),
        getCurrentActivity(deviceId).catch(() => ''),
      ]);
      sendJson(res, { deviceId, xml, activity, dumpedAt: new Date().toISOString() });
      return true;
    }

    if (pathname === '/api/appium-recorder/tap' && req.method === 'POST') {
      const parsed = await readBody<{ deviceId?: string; x?: number; y?: number }>(req);
      const deviceId = parsed.deviceId?.trim() || selectedDeviceId;
      if (!deviceId) throw new Error('未检测到可用设备');
      assertDeviceAllowed(deviceId);
      if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) throw new Error('点击坐标无效');
      if (isRemoteDeviceId(deviceId)) {
        await sendRemoteCommand(deviceId, 'tap', { x: Number(parsed.x), y: Number(parsed.y) });
        sendJson(res, { success: true });
        return true;
      }
      await tapDevice(deviceId, Number(parsed.x), Number(parsed.y));
      sendJson(res, { success: true });
      return true;
    }

    if (pathname === '/api/appium-recorder/key' && req.method === 'POST') {
      const parsed = await readBody<{ deviceId?: string; keyCode?: number }>(req);
      const deviceId = parsed.deviceId?.trim() || selectedDeviceId;
      const keyCode = Number(parsed.keyCode);
      if (!deviceId) throw new Error('未检测到可用设备');
      assertDeviceAllowed(deviceId);
      if (!Number.isFinite(keyCode)) throw new Error('按键无效');
      if (isRemoteDeviceId(deviceId)) {
        await sendRemoteCommand(deviceId, 'key', { keyCode });
        sendJson(res, { success: true });
        return true;
      }
      await pressDeviceKey(deviceId, keyCode);
      sendJson(res, { success: true });
      return true;
    }

    if (pathname === '/api/appium-recorder/launch-app' && req.method === 'POST') {
      const parsed = await readBody<{ deviceId?: string; packageName?: string }>(req);
      const deviceId = parsed.deviceId?.trim() || selectedDeviceId;
      const packageName = parsed.packageName?.trim() || '';
      if (!deviceId) throw new Error('未检测到可用设备');
      if (!packageName) throw new Error('请选择预设 App');
      assertDeviceAllowed(deviceId);
      if (isRemoteDeviceId(deviceId)) throw new Error('远程设备暂不支持直接启动 App');
      await launchAppOnDevice(deviceId, packageName);
      sendJson(res, { success: true });
      return true;
    }

    if (pathname === '/api/appium-recorder/clear-app-data' && req.method === 'POST') {
      const parsed = await readBody<{ deviceId?: string; packageName?: string }>(req);
      const deviceId = parsed.deviceId?.trim() || selectedDeviceId;
      const packageName = parsed.packageName?.trim() || '';
      if (!deviceId) throw new Error('未检测到可用设备');
      if (!packageName) throw new Error('请选择预设 App');
      assertDeviceAllowed(deviceId);
      if (isRemoteDeviceId(deviceId)) throw new Error('远程设备暂不支持清理 App 缓存');
      await clearAppDataOnDevice(deviceId, packageName);
      sendJson(res, { success: true });
      return true;
    }

    if (pathname === '/api/appium-recorder/scripts' && req.method === 'GET') {
      sendJson(res, { scripts: listAppiumRecordedScripts() });
      return true;
    }

    if (pathname === '/api/appium-recorder/scripts' && req.method === 'POST') {
      const parsed = await readBody<{
        id?: string;
        name?: string;
        appPackage?: string;
        appActivity?: string;
        deviceId?: string;
        steps?: AppiumRecordedStepRecord[];
      }>(req);
      const script = saveAppiumRecordedScript({
        id: parsed.id,
        name: parsed.name || '',
        appPackage: parsed.appPackage || '',
        appActivity: parsed.appActivity || '',
        deviceId: parsed.deviceId || selectedDeviceId,
        steps: parsed.steps || [],
      });
      sendJson(res, { script });
      return true;
    }

    if (pathname === '/api/appium-recorder/scripts/import' && req.method === 'POST') {
      const parsed = await readBody<{
        schemaVersion?: number;
        script?: {
          name?: string;
          appPackage?: string;
          appActivity?: string;
          deviceId?: string;
          steps?: AppiumRecordedStepRecord[];
        };
      }>(req);
      const imported = parsed.script;
      if (!imported || typeof imported !== 'object') throw new Error('导入文件缺少 script 数据');
      if (!Array.isArray(imported.steps)) throw new Error('导入文件的 steps 格式无效');
      const invalidStep = imported.steps.some((step) => (
        !step || typeof step !== 'object' || typeof step.id !== 'string' || typeof step.type !== 'string'
      ));
      if (invalidStep) throw new Error('导入文件包含无效节点');
      const script = importAppiumRecordedScript({
        name: imported.name || '',
        appPackage: imported.appPackage || '',
        appActivity: imported.appActivity || '',
        deviceId: imported.deviceId || '',
        steps: imported.steps,
      });
      sendJson(res, { script });
      return true;
    }

    const exportMatch = pathname.match(/^\/api\/appium-recorder\/scripts\/([^/]+)\/export$/);
    if (exportMatch && req.method === 'GET') {
      const script = getAppiumRecordedScript(decodeURIComponent(exportMatch[1]));
      if (!script) throw new Error('Appium 录制脚本不存在');
      sendJsonDownload(res, {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        script: {
          name: script.name,
          appPackage: script.appPackage,
          appActivity: script.appActivity,
          deviceId: script.deviceId,
          steps: script.steps,
        },
      }, `${script.name}.json`);
      return true;
    }

    const deleteMatch = pathname.match(/^\/api\/appium-recorder\/scripts\/([^/]+)$/);
    if (deleteMatch && req.method === 'DELETE') {
      deleteAppiumRecordedScript(decodeURIComponent(deleteMatch[1]));
      sendJson(res, { success: true });
      return true;
    }

    if (pathname === '/api/appium-recorder/replay/stop' && req.method === 'POST') {
      const parsed = await readBody<{ deviceId?: string }>(req);
      const deviceId = parsed.deviceId || selectedDeviceId;
      assertDeviceAllowed(deviceId);
      const controller = replayAbortControllers.get(deviceId);
      controller?.abort();
      sendJson(res, { success: true, stopped: Boolean(controller) });
      return true;
    }

    const replayMatch = pathname.match(/^\/api\/appium-recorder\/scripts\/([^/]+)\/replay$/);
    if (replayMatch && req.method === 'POST') {
      const parsed = await readBody<{ deviceId?: string }>(req);
      const script = getAppiumRecordedScript(decodeURIComponent(replayMatch[1]));
      if (!script) throw new Error('Appium 录制脚本不存在');
      const deviceId = parsed.deviceId || selectedDeviceId;
      assertDeviceAllowed(deviceId);
      const streamOutput = req.headers.accept?.includes('application/x-ndjson') === true;
      if (streamOutput) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
      }
      if (isRemoteDeviceId(deviceId)) {
        const result = await sendRemoteCommand(deviceId, 'replay', { script }) as { success?: boolean; output?: string };
        if (streamOutput) {
          result.output?.split(/\r?\n/).forEach((line) => sendStreamEvent(res, { type: 'log', line }));
          sendStreamEvent(res, { type: 'result', ...result });
          res.end();
        } else {
          sendJson(res, result, result.success ? 200 : 500);
        }
        return true;
      }
      if (replayingDevices.has(deviceId)) throw new Error('该设备已有回放任务正在执行');
      const replayAbortController = new AbortController();
      replayingDevices.add(deviceId);
      replayAbortControllers.set(deviceId, replayAbortController);
      try {
        await treeDumpTasks.get(deviceId)?.catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const result = await replayAppiumScript(
          script,
          deviceId,
          streamOutput ? (line) => sendStreamEvent(res, { type: 'log', line }) : undefined,
          replayAbortController.signal,
        );
        if (streamOutput) {
          sendStreamEvent(res, { type: 'result', ...result });
          res.end();
        } else {
          sendJson(res, result, result.success ? 200 : 500);
        }
      } finally {
        replayingDevices.delete(deviceId);
        if (replayAbortControllers.get(deviceId) === replayAbortController) {
          replayAbortControllers.delete(deviceId);
        }
      }
      return true;
    }

    sendJson(res, { message: 'Appium Recorder 接口不存在' }, 404);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Appium Recorder 请求失败';
    if (res.headersSent) {
      sendStreamEvent(res, { type: 'error', message });
      res.end();
    } else {
      sendJson(res, { message }, 500);
    }
    return true;
  }
}

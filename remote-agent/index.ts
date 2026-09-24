import { execFile } from 'node:child_process';
import os from 'node:os';
import { readAndroidDeviceInfo } from '../server/android-device-info';
import { readFreshWindowHierarchy } from '../server/appium-recorder/tree-dump';
import type { RemoteAgentDevice, RemoteCommand } from '../server/remote-agents/protocol';
import { replayAppiumScript } from '../server/appium-recorder/appium-runner';
import type { AppiumRecordedScriptRecord } from '../server/appium-recorder/repository';

const VERSION = '0.2.3';
const replays = new Map<string, AbortController>();
let lastHeartbeatAt = Date.now();

function argValue(name: string, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const server = argValue('server').replace(/\/+$/, '');
const agentId = argValue('agent-id', os.hostname()).replace(/:/g, '-');
const agentName = argValue('agent-name', agentId);
const token = argValue('token', process.env.REMOTE_AGENT_TOKEN || '');

if (!server) {
  console.error('缺少 --server，例如：npm run remote-agent -- --server http://<控制台主机地址>:5173');
  process.exit(1);
}

function execText(command: string, args: string[] = []) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { maxBuffer: 20 * 1024 * 1024, timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

function execBuffer(command: string, args: string[] = []) {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(command, args, { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024, timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(Buffer.isBuffer(stderr) ? stderr.toString() : stderr || error.message));
        return;
      }
      resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
    });
  });
}

async function postJson<T>(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
  return payload;
}

async function listDevices(): Promise<RemoteAgentDevice[]> {
  const output = await execText('adb', ['devices', '-l']);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices attached'))
    .map((line) => {
      const parts = line.split(/\s+/);
      const id = parts[0] || '';
      const status = parts[1] || 'unknown';
      const model = parts.find((part) => part.startsWith('model:'))?.slice(6) || '';
      const device = parts.find((part) => part.startsWith('device:'))?.slice(7) || '';
      return { id, status, model, description: device || status };
    })
    .filter((device) => device.id);
}

async function getDisplayInfo(deviceId: string) {
  const output = await execText('adb', ['-s', deviceId, 'shell', 'wm', 'size']);
  const match = output.match(/Override size:\s*(\d+)x(\d+)/i) || output.match(/Physical size:\s*(\d+)x(\d+)/i);
  if (!match) throw new Error('读取设备分辨率失败');
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function dumpWindowHierarchy(deviceId: string) {
  return readFreshWindowHierarchy(deviceId, 'adb', execText);
}

async function getCurrentActivity(deviceId: string) {
  const output = await execText('adb', ['-s', deviceId, 'shell', 'dumpsys', 'activity', 'activities']);
  const resumedLine = output
    .split(/\r?\n/)
    .find((line) => /(?:topResumedActivity|ResumedActivity|mResumedActivity)/.test(line));
  return resumedLine?.match(/\s([\w.$]+\/[\w.$]+)\s/)?.[1] || '';
}

async function handleCommand(command: RemoteCommand, signal?: AbortSignal) {
  const payload = command.payload || {};
  if (command.type === 'screenshot') {
    const image = await execBuffer('adb', ['-s', command.deviceId, 'exec-out', 'screencap', '-p']);
    return { base64: image.toString('base64') };
  }
  if (command.type === 'displayInfo') return await getDisplayInfo(command.deviceId);
  if (command.type === 'deviceInfo') return await readAndroidDeviceInfo(command.deviceId, 'adb');
  if (command.type === 'tree') {
    const [xml, activity] = await Promise.all([
      dumpWindowHierarchy(command.deviceId),
      getCurrentActivity(command.deviceId).catch(() => ''),
    ]);
    return { xml, activity, dumpedAt: new Date().toISOString() };
  }
  if (command.type === 'tap') {
    await execText('adb', ['-s', command.deviceId, 'shell', 'input', 'tap', String(Math.round(Number(payload.x))), String(Math.round(Number(payload.y)))]);
    return { success: true };
  }
  if (command.type === 'swipe') {
    await execText('adb', [
      '-s',
      command.deviceId,
      'shell',
      'input',
      'swipe',
      String(Math.round(Number(payload.startX))),
      String(Math.round(Number(payload.startY))),
      String(Math.round(Number(payload.endX))),
      String(Math.round(Number(payload.endY))),
      String(Math.max(80, Math.round(Number(payload.duration) || 160))),
    ]);
    return { success: true };
  }
  if (command.type === 'key') {
    await execText('adb', ['-s', command.deviceId, 'shell', 'input', 'keyevent', String(Math.round(Number(payload.keyCode)))]);
    return { success: true };
  }
  if (command.type === 'replay') {
    const script = payload.script as AppiumRecordedScriptRecord | undefined;
    if (!script) throw new Error('远程回放缺少脚本内容');
    return await replayAppiumScript(script, command.deviceId, undefined, signal, {
      screenshotReport: payload.screenshotReport === true,
      reportSummaryEnabled: typeof payload.reportSummaryEnabled === 'boolean' ? payload.reportSummaryEnabled : undefined,
      reportSummaryPrompt: typeof payload.reportSummaryPrompt === 'string' ? payload.reportSummaryPrompt : undefined,
      parameters: payload.parameters as import('../src/appium-recorder/variables').TestVariable[] | undefined,
      globalVariables: payload.globalVariables as import('../src/appium-recorder/variables').TestVariable[] | undefined,
      linkedScripts: payload.linkedScripts as AppiumRecordedScriptRecord[] | undefined,
    });
  }
  throw new Error(`不支持的命令：${command.type}`);
}

async function heartbeat() {
  const devices = await listDevices().catch((error) => {
    console.warn(`扫描设备失败：${error instanceof Error ? error.message : String(error)}`);
    return [];
  });
  const control = await postJson<{ cancelledCommandIds?: string[] }>(`${server}/api/remote-agents/heartbeat`, {
    agentId,
    agentName,
    version: VERSION,
    token,
    devices,
  });
  lastHeartbeatAt = Date.now();
  for (const id of control.cancelledCommandIds || []) replays.get(id)?.abort();
  console.log(`已上报 ${devices.length} 台设备到 ${server}`);
}

async function reportResult(command: RemoteCommand, ok: boolean, data?: unknown, error?: string) {
  // 上报失败只重试结果，绝不重新执行已经操作过设备的脚本。
  for (;;) {
    try {
      await postJson(`${server}/api/remote-agents/result`, { agentId, token, commandId: command.id, ok, data, error });
      return;
    } catch (error) {
      if (command.type !== 'replay') throw error;
      console.warn(`结果上报失败，正在重试：${error instanceof Error ? error.message : String(error)}`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

async function pollOnce() {
  const url = new URL(`${server}/api/remote-agents/poll`);
  url.searchParams.set('agentId', agentId);
  if (token) url.searchParams.set('token', token);
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const payload = await response.json().catch(() => ({})) as { command?: RemoteCommand | null; message?: string };
  if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
  if (!payload.command) return;
  const command = payload.command;
  const controller = command.type === 'replay' ? new AbortController() : undefined;
  if (controller) {
    replays.set(command.id, controller);
    if (command.cancelled) controller.abort();
  }
  try {
    let result: unknown;
    try {
      result = await handleCommand(command, controller?.signal);
    } catch (error) {
      await reportResult(command, false, undefined, error instanceof Error ? error.message : String(error));
      return;
    }
    await reportResult(command, true, result);
  } finally { replays.delete(command.id); }
}

async function main() {
  console.log(`Remote Agent 启动：${agentId}`);
  console.log(`中央服务：${server}`);
  await heartbeat();
  let heartbeatTask: Promise<void> | undefined;
  setInterval(() => {
    if (Date.now() - lastHeartbeatAt >= 45000) {
      for (const controller of replays.values()) controller.abort();
    }
    if (!heartbeatTask) heartbeatTask = heartbeat()
      .catch(error => console.warn(`心跳失败：${error.message}`))
      .finally(() => { heartbeatTask = undefined; });
  }, 3000);
  for (;;) {
    await pollOnce().catch((error) => console.warn(`轮询失败：${error.message}`));
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

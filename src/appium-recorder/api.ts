import { APP_BASE } from '../api';
import type { AppiumRecordedScript, AppiumRecordedStep } from './types';

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    output?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.output || payload.message || payload.error || `请求失败（HTTP ${response.status}）`);
  }
  return payload;
}

function postJson<T>(url: string, body?: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then((response) => readJson<T>(response));
}

export async function getAppiumTree(deviceId: string) {
  const response = await fetch(`${APP_BASE}/api/appium-recorder/tree?deviceId=${encodeURIComponent(deviceId)}`);
  return readJson<{ deviceId: string; xml: string; activity: string; dumpedAt: string }>(response);
}

export function tapAppiumDevice(input: { deviceId: string; x: number; y: number }) {
  return postJson<{ success: boolean }>(`${APP_BASE}/api/appium-recorder/tap`, input);
}

export function pressAppiumDeviceKey(input: { deviceId: string; keyCode: number }) {
  return postJson<{ success: boolean }>(`${APP_BASE}/api/appium-recorder/key`, input);
}

export function launchAppiumDeviceApp(input: { deviceId: string; packageName: string }) {
  return postJson<{ success: boolean }>(`${APP_BASE}/api/appium-recorder/launch-app`, input);
}

export function clearAppiumDeviceAppData(input: { deviceId: string; packageName: string }) {
  return postJson<{ success: boolean }>(`${APP_BASE}/api/appium-recorder/clear-app-data`, input);
}

export async function getAppiumScripts() {
  const response = await fetch(`${APP_BASE}/api/appium-recorder/scripts`);
  return readJson<{ scripts: AppiumRecordedScript[] }>(response);
}

export function saveAppiumScript(input: {
  id?: string;
  name: string;
  appPackage: string;
  appActivity?: string;
  deviceId?: string;
  steps: AppiumRecordedStep[];
}) {
  return postJson<{ script: AppiumRecordedScript }>(`${APP_BASE}/api/appium-recorder/scripts`, input);
}

export function deleteAppiumScript(id: string) {
  return fetch(`${APP_BASE}/api/appium-recorder/scripts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }).then((response) => readJson<{ success: boolean }>(response));
}

export function importAppiumScript(input: unknown) {
  return postJson<{ script: AppiumRecordedScript }>(`${APP_BASE}/api/appium-recorder/scripts/import`, input);
}

export function appiumScriptDownloadUrl(id: string) {
  return `${APP_BASE}/api/appium-recorder/scripts/${encodeURIComponent(id)}/export`;
}

type ReplayResult = {
  success: boolean;
  stopped?: boolean;
  output: string;
  reportPath?: string;
  reportId?: string;
  logPath?: string;
  htmlReportPath?: string;
};

type ReplayStreamEvent =
  | { type: 'log'; line: string }
  | ({ type: 'result' } & ReplayResult)
  | { type: 'error'; message: string };

export async function replayAppiumScript(
  input: { id: string; deviceId?: string },
  onOutput?: (line: string) => void,
) {
  const response = await fetch(`${APP_BASE}/api/appium-recorder/scripts/${encodeURIComponent(input.id)}/replay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
    },
    body: JSON.stringify({ deviceId: input.deviceId }),
  });
  if (!response.ok || !response.body) return readJson<ReplayResult>(response);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: ReplayResult | undefined;

  const consumeLine = (value: string) => {
    if (!value.trim()) return;
    const event = JSON.parse(value) as ReplayStreamEvent;
    if (event.type === 'log') onOutput?.(event.line);
    if (event.type === 'result') result = event;
    if (event.type === 'error') throw new Error(event.message);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(consumeLine);
    if (done) break;
  }
  consumeLine(buffer);
  if (!result) throw new Error('回放结束但未返回执行结果');
  return result;
}

export function stopAppiumReplay(deviceId?: string) {
  return postJson<{ success: boolean; stopped: boolean }>(
    `${APP_BASE}/api/appium-recorder/replay/stop`,
    { deviceId },
  );
}

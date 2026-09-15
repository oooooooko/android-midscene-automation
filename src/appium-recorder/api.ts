import { APP_BASE } from '../api';
import type { AppiumRecordedScript, AppiumRecordedStep } from './types';
import type { AiRecognitionResult } from './ai-recognition';
import type { TestVariable } from './variables';
import type { AppiumVisualChangeRegion } from './types';

export function captureImageCheckRegion(deviceId: string, region: AppiumVisualChangeRegion, screenWidth: number, screenHeight: number) {
  return postJson<{ base64: string; screenWidth: number; screenHeight: number }>(`${APP_BASE}/api/appium-recorder/image-check/capture`, { deviceId, region, screenWidth, screenHeight });
}

// 队列跨组件挂载保留，切换脚本或清空草稿时仍按编辑顺序写入。
const variableWrites = new Map<string, Promise<unknown>>();
export function saveVariables(url: string, variables: TestVariable[]) {
  const body = JSON.stringify({ variables });
  const task = (variableWrites.get(url) || Promise.resolve()).catch(() => {}).then(async () => {
    return readJson<{ variables: TestVariable[] }>(await fetch(url, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
    }));
  });
  variableWrites.set(url, task);
  void task.finally(() => { if (variableWrites.get(url) === task) variableWrites.delete(url); }).catch(() => {});
  return task;
}

export async function loadVariables(url: string) {
  await variableWrites.get(url)?.catch(() => {});
  return readJson<{ variables: TestVariable[] }>(await fetch(url));
}

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
  const response = await fetch(`${APP_BASE}/api/appium-recorder/tree?deviceId=${encodeURIComponent(deviceId)}`, { cache: 'no-store' });
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

export async function testAiRecognition(input: { deviceId: string; prompt: string; timeoutMs?: number }, signal?: AbortSignal) {
  const response = await fetch(`${APP_BASE}/api/appium-recorder/ai-recognition/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal,
  });
  return readJson<AiRecognitionResult & { imageBase64: string }>(response);
}

export function saveAppiumScript(input: {
  variables?: import('./variables').TestVariable[];
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

export async function downloadAppiumScript(id: string) {
  const response = await fetch(`${APP_BASE}/api/appium-recorder/scripts/${encodeURIComponent(id)}/export`);
  if (!response.ok) await readJson(response);
  const disposition = response.headers.get('Content-Disposition') || '';
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const extension = response.headers.get('Content-Type')?.includes('application/zip') ? 'zip' : 'json';
  return {
    fileName: encodedName ? decodeURIComponent(encodedName) : `appium-script.${extension}`,
    blob: await response.blob(),
  };
}

type ReplayResult = {
  success: boolean;
  stopped?: boolean;
  output: string;
  reportPath?: string;
  reportId?: string;
  logPath?: string;
  htmlReportPath?: string;
  softFailureCount?: number;
};

type ReplayStreamEvent =
  | { type: 'log'; line: string }
  | ({ type: 'result' } & ReplayResult)
  | { type: 'error'; message: string };

export async function replayAppiumScript(
  input: { id: string; deviceId?: string; parameters?: import('./variables').TestVariable[] },
  onOutput?: (line: string) => void,
) {
  const response = await fetch(`${APP_BASE}/api/appium-recorder/scripts/${encodeURIComponent(input.id)}/replay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
    },
    body: JSON.stringify({ deviceId: input.deviceId, parameters: input.parameters }),
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

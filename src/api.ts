import type { ScriptStep } from './script-generator';
import type {
  AndroidDevice,
  AppPreset,
  ConfigForm,
  DeviceLock,
  DeviceSession,
  ModelUsageRecord,
  OperationEvent,
  OperationRecord,
  RunScriptStreamEvent,
  SavedScript,
  TestCaseImportResult,
} from './types';

// 应用挂载基路径：独立运行（dev/preview）时为 ''，作为 DSH 插件挂载在
// /midscene 下时由 vite 的 base 推导为 '/midscene'。所有后端调用都拼上它。
export const APP_BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

// 统一解析接口响应，并把后端 message 转成前端可直接展示的 Error。
async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message || '请求失败');
  }
  return payload;
}

// 项目内大部分接口都是 JSON POST，这里集中处理请求头和错误转换。
async function postJson<T>(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return readJson<T>(response);
}

// 读取已保存的脚本列表，自动化测试页面左侧脚本列表使用。
export async function getScripts() {
  const response = await fetch(`${APP_BASE}/api/scripts`);
  return readJson<{ scripts?: SavedScript[] }>(response);
}

// 检查脚本名称对应的本地脚本文件是否已经存在，用于保存前同名校验。
export function checkScript(input: { scriptName: string }) {
  return postJson<{ exists?: boolean; filePath?: string }>(`${APP_BASE}/api/check-script`, input);
}

// 校验生成页编辑后的 TypeScript 代码，只返回校验结果，不写入脚本文件或数据库。
export function validateScriptCode(input: { code: string }) {
  return postJson<{ valid: true }>(`${APP_BASE}/api/validate-script-code`, input);
}

// 上传单个测试用例文件；后端负责解析、有效性校验并返回规范化 Prompt。
export async function importTestCaseFile(file: File) {
  const response = await fetch(`${APP_BASE}/api/import-test-case?fileName=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  return readJson<TestCaseImportResult>(response);
}

// 保存生成后的脚本代码、场景标题、原始 Prompt 和结构化步骤到 SQLite 与 scripts-output。
export function saveScript(input: {
  scriptName: string;
  code: string;
  promptTitle: string;
  sourcePrompt: string;
  steps: ScriptStep[];
}) {
  return postJson<{ success?: boolean; filePath?: string; script?: SavedScript }>(`${APP_BASE}/api/save-script`, input);
}

// 删除脚本记录，并删除 scripts-output 下对应的脚本文件。
export function deleteScript(input: { id: string }) {
  return postJson<{ success?: boolean; deletedFile?: boolean; script?: SavedScript }>(`${APP_BASE}/api/delete-script`, input);
}

// 保存脚本查看弹窗里编辑后的代码；后端会先做 TypeScript 格式校验。
export function updateScriptCode(input: { id: string; code: string }) {
  return postJson<{ success?: boolean; script?: SavedScript }>(`${APP_BASE}/api/update-script-code`, input);
}

// 调用脚本优化模型，把原始 Prompt 转成项目内的结构化步骤。
export function generatePlan(input: { prompt: string }) {
  return postJson<{
    promptTitle?: string;
    steps?: Array<Omit<ScriptStep, 'id'>>;
    raw?: string;
    durationMs?: number;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  }>(`${APP_BASE}/api/generate`, input);
}

// 读取模型配置和脚本优化模型配置。
export async function getConfig() {
  const response = await fetch(`${APP_BASE}/api/config`);
  return readJson<ConfigForm>(response);
}

// 保存模型配置；当前由参数配置页的各模块保存按钮调用。
export function saveConfig(input: ConfigForm) {
  return postJson<{ success?: boolean } | ConfigForm>(`${APP_BASE}/api/config`, input);
}

// 测试指定模型配置是否可用，通常用于保存前验证 baseUrl/apiKey/model。
export function testModel(input: {
  modelKey: 'midscene' | 'scriptOptimizer';
  model: {
    provider?: 'custom' | 'codex';
    baseUrl: string;
    apiKey: string;
    name: string;
    family?: string;
  };
}) {
  return postJson<{
    content?: string;
    durationMs?: number;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  }>(`${APP_BASE}/api/test-model`, input);
}

// 读取模型测试消耗记录，后端按时间保存在 SQLite。
export async function getModelUsageRecords(limit = 50) {
  const response = await fetch(`${APP_BASE}/api/model-usage-records?limit=${encodeURIComponent(String(limit))}`);
  return readJson<{ records?: ModelUsageRecord[] }>(response);
}

// 读取预设 App 列表，测试脚本生成时用于自动拼接 App 名称和包名上下文。
export async function getAppPresets() {
  const response = await fetch(`${APP_BASE}/api/app-presets`);
  return readJson<{ apps?: AppPreset[] }>(response);
}

// 新增或更新预设 App；同名或同包名校验由后端负责。
export function saveAppPreset(input: { id?: string; name: string; packageName: string }) {
  return postJson<{ app?: AppPreset }>(`${APP_BASE}/api/save-app-preset`, input);
}

// 删除一个预设 App 配置。
export function deleteAppPreset(input: { id: string }) {
  return postJson<{ success?: boolean }>(`${APP_BASE}/api/delete-app-preset`, input);
}

// 读取 ADB 设备列表，并让后端确保当前设备会话存在。
export async function getAndroidDevices() {
  const response = await fetch(`${APP_BASE}/api/android-devices`);
  return readJson<{ devices?: AndroidDevice[]; currentDeviceId?: string }>(response);
}

// 读取后端缓存的设备会话状态，用于排查页面切换后是否复用同一设备连接。
export async function getDeviceSessions() {
  const response = await fetch(`${APP_BASE}/api/device-sessions`);
  return readJson<{ sessions?: DeviceSession[] }>(response);
}

// 读取当前活跃设备锁，用于排查是否有脚本执行占用某台手机。
export async function getDeviceLocks() {
  const response = await fetch(`${APP_BASE}/api/device-locks`);
  return readJson<{ locks?: DeviceLock[] }>(response);
}

// 读取脚本执行记录列表，包含执行状态、设备、脚本名和结果摘要。
export async function getOperations(limit = 30) {
  const response = await fetch(`${APP_BASE}/api/operations?limit=${encodeURIComponent(String(limit))}`);
  return readJson<{ operations?: OperationRecord[] }>(response);
}

// 读取单次脚本执行详情和事件流，便于查看输出、步骤事件和失败原因。
export async function getOperation(operationId: string) {
  const response = await fetch(`${APP_BASE}/api/operations/${encodeURIComponent(operationId)}`);
  return readJson<{ operation?: OperationRecord; events?: OperationEvent[] }>(response);
}

// 读取 Android 设备分辨率，用于把预览区域坐标映射到真实设备坐标。
export async function getAndroidDisplayInfo(deviceId: string) {
  const response = await fetch(`${APP_BASE}/api/android-display-info?deviceId=${encodeURIComponent(deviceId)}`);
  return readJson<{ width?: number; height?: number }>(response);
}

// 查询 Android Playground 状态；后端会同步更新设备会话中的预览连接信息。
export async function getPlaygroundStatus() {
  const response = await fetch(`${APP_BASE}/api/playground-status`);
  return readJson<{
    available?: boolean;
    url?: string;
    deviceId?: string;
    previewKind?: string;
    sessionConnected?: boolean;
    previewError?: string;
    setupState?: string;
  }>(response);
}

// 切换当前自动化测试设备，并创建或复用对应设备会话。
export function setAndroidDevice(input: { deviceId: string }) {
  return postJson<{ currentDeviceId?: string }>(`${APP_BASE}/api/android-device`, input);
}

// 向 Android 设备发送 tap 坐标，用于设备预览中的鼠标/触摸点击。
export function tapAndroid(input: { deviceId: string; x: number; y: number }) {
  return postJson<{ success?: boolean; message?: string }>(`${APP_BASE}/api/android-tap`, input);
}

// 向 Android 设备发送 swipe 手势，用于设备预览中的拖动操作。
export function swipeAndroid(input: {
  deviceId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  duration: number;
}) {
  return postJson<{ success?: boolean; message?: string }>(`${APP_BASE}/api/android-swipe`, input);
}

// 向 Android 设备发送系统按键，例如返回、Home、任务、音量、电源等。
export function sendAndroidKeyevent(input: { deviceId: string; keyCode: number }) {
  return postJson<{ success?: boolean; message?: string }>(`${APP_BASE}/api/android-keyevent`, input);
}

// 停止当前脚本执行进程；后端会中止运行并释放设备锁。
export function stopScript() {
  return postJson<{ success?: boolean; stopped?: boolean }>(`${APP_BASE}/api/stop-script`);
}

// run-script 返回 NDJSON 流，每一行都是一个执行事件，边读边回调给执行面板更新 UI。
export async function runScript(
  input: {
    code: string;
    scriptName: string;
    deviceId: string;
    steps: ScriptStep[];
    signal?: AbortSignal;
  },
  onEvent: (event: RunScriptStreamEvent) => void,
) {
  const response = await fetch(`${APP_BASE}/api/run-script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: input.signal,
    body: JSON.stringify({
      code: input.code,
      scriptName: input.scriptName,
      deviceId: input.deviceId,
      steps: input.steps,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || '执行失败');
  }

  if (!response.body) {
    throw new Error('执行接口没有返回输出流');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // 分块数据可能把一行 JSON 拆开，buffer 保留未读完的半行。
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line) as RunScriptStreamEvent);
    }
    if (done) break;
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as RunScriptStreamEvent);
  }
}
import type { ScriptStep } from './script-generator';
import type { MidsceneModelProvider } from './config/midscene-model-presets';

export type MenuKey = 'generator' | 'automation' | 'config' | 'appium';
export type GeneratorMode = 'ai' | 'manual';

export type GeneratorForm = {
  promptTitle: string;
  testName: string;
  appPresetId: string;
};

export type ConfigForm = {
  runtime: {
    androidSdkPath: string;
    reportOutputPath: string;
  };
  midscene: {
    model: {
      provider: MidsceneModelProvider;
      baseUrl: string;
      apiKey: string;
      name: string;
      family: string;
    };
    env: Record<string, string>;
  };
  scriptOptimizer: {
    model: {
      baseUrl: string;
      apiKey: string;
      name: string;
    };
  };
};

export type SavedScript = {
  id: string;
  name: string;
  promptTitle: string;
  sourcePrompt: string;
  code: string;
  filePath: string;
  steps: ScriptStep[];
  createdAt: string;
  updatedAt: string;
};

export type AppPreset = {
  id: string;
  name: string;
  packageName: string;
  createdAt: string;
  updatedAt: string;
};

export type TestCaseImportResult = {
  fileName: string;
  format: 'txt' | 'excel' | 'word';
  caseCount: number;
  prompt: string;
};

export type ExecutionStep = {
  id: string;
  sourceIndex: number;
  title: string;
  method: string;
  prompt: string;
  status: 'pending' | 'running' | 'success' | 'error';
  detail: string;
  startedAt?: number;
};

// 后端执行脚本时按 NDJSON 推送这些事件，前端执行面板逐条消费。
export type RunScriptStreamEvent =
  | { type: 'operation'; operation: unknown }
  | { type: 'output'; chunk: string }
  | { type: 'step'; status: 'start' | 'success' | 'error'; index: number; id?: string; title?: string; detail?: string }
  | { type: 'done'; success: boolean; output: string; filePath: string }
  | { type: 'error'; message: string };

export type AndroidDevice = {
  id: string;
  status: string;
  description: string;
};

export type DeviceSession = {
  id: string;
  deviceId: string;
  status: 'active' | 'expired' | 'closed';
  playgroundUrl: string;
  previewKind: string;
  sessionConnected: boolean;
  setupState: string;
  previewError: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  idleExpiresAt: string;
};

export type DeviceLock = {
  id: string;
  deviceId: string;
  ownerType: 'script_run' | 'manual_action' | 'preview';
  ownerId: string;
  metadata: Record<string, unknown>;
  acquiredAt: string;
  expiresAt: string;
  releasedAt: string;
};

export type OperationRecord = {
  id: string;
  kind: 'script_run';
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  scriptName: string;
  deviceId: string;
  sessionId: string;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  output: string;
  filePath: string;
  errorMessage: string;
  createdAt: string;
  startedAt: string;
  finishedAt: string;
};

export type OperationEvent = {
  seq: number;
  operationId: string;
  timestamp: string;
  eventType: string;
  message: string;
  data: Record<string, unknown>;
};

// 设备预览顶部工具栏的硬件按键动作定义。
export type DeviceAction = {
  key: string;
  label: string;
  icon: string;
  keyCode: number;
};

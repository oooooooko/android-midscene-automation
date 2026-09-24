import { resolveReportSummary } from '../../src/appium-recorder/report-summary';
import { execFile } from 'node:child_process';
import { VariableScope, variableContext, resolveVariableStep } from './variables';
import { getPresetVariables } from './variable-store';
import { validateExtraction, validateVariables, type TestVariable } from '../../src/appium-recorder/variables';
import { captureHistoryFrames, readAppVersion } from './history-capture';
import { BoundedLoopTraversal } from './bounded-loop';
import { validateLoopSteps } from '../../src/appium-recorder/bounded-loop';
import { adbScreenshotBase64 } from './screenshot';
import { loadConfig } from '../config';
import { timestampReplayLog } from './replay-log';
import { checkImage } from './image-check';
import { recognizeDeviceScreen, resolveAiInvalidResultFallback } from './ai-recognition';
import { IMAGE_CHECK_MODES, type ImageCheckResult } from '../../src/appium-recorder/image-check';
import { formatStageLog } from '../../src/appium-recorder/stage-log';
import { openGalleryOnDevice } from './open-gallery';
import { stopAppOnDevice } from './stop-app';
import { DEFAULT_NODE_TIMEOUT_MS } from '../../src/appium-recorder/node-timeout';
import { startReplayVideo, type ReplayVideo } from './replay-video';
import { ConditionTimeoutError, AppiumServiceError } from './condition-timeout';
import { AppiumRequestTimeoutError, timedAppiumFetch, withElementDeadline } from './request-timeout';
import { textClickSelector } from '../../src/appium-recorder/text-click';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { linkedScriptSnapshot, type AppiumRecordedScriptRecord, type AppiumRecordedStepRecord } from './repository';
import { appDataPath } from '../paths';
import { ensureAndroidSdkAvailable, getAdbCommand } from '../android-sdk';
import { createAppiumReplayReport, type AppiumReplayFrame, type AppiumReplayVisualCheck } from './report';
import { startManagedAppiumServer, stopManagedUiAutomator, usesManagedAppiumServer } from './managed-appium';
import { compareVisualChangeFrames, type VisualChangeRegion } from './visual-change';
import { longPressMode, validateLongPress } from '../../src/appium-recorder/long-press';
import { defaultFlowKind, flowBranchLabel } from '../../src/appium-recorder/flow-labels';
import { isNativeStateCondition, nativeControlName, matchesNativeControl, parseNativeBoolean } from '../../src/appium-recorder/native-control-state';

type AppiumSessionResponse = {
  value?: {
    sessionId?: string;
    capabilities?: unknown;
  };
  sessionId?: string;
};

type AppiumElementResponse = {
  value?: Record<string, string>;
};

type AppiumValueResponse<T> = {
  value?: T;
};

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const configuredAppiumServerUrl = () => (process.env.APPIUM_SERVER_URL || 'http://127.0.0.1:4723').replace(/\/+$/, '');

class ReplayStoppedError extends Error {
  constructor() {
    super('用户手动终止');
    this.name = 'ReplayStoppedError';
  }
}

type PendingVisualChangeCheck = {
  step: AppiumRecordedStepRecord;
  nodeNumber: number;
  scriptName: string;
  frameStart: number;
  endFrameStart: number;
};

const replayContext = new AsyncLocalStorage<{
  signal?: AbortSignal;
  appiumLog: (line: string) => void;
  serverUrl: string;
  deviceId: string;
  scripts: Map<string, AppiumRecordedScriptRecord>;
  frames: AppiumReplayFrame[];
  screenshotReport: boolean;
  visualCaptureNodes: Set<string>;
  historyEvents: AppiumReplayFrame[];
  visualChecks: AppiumReplayVisualCheck[];
  imageChecks: Array<ImageCheckResult & { nodeId: string; nodeNumber: number; nodeLabel: string; scriptName: string; settings: string }>;
  pendingVisualChecks: PendingVisualChangeCheck[];
  visualStartOffsets: Map<string, number>;
  softFailureCount: number;
  flowEnded?: boolean;
  selectVideoScript?: (id: string, name: string, force?: boolean) => Promise<void>;
}>();

const appiumServerUrl = () => replayContext.getStore()?.serverUrl || configuredAppiumServerUrl();

function isReplayStopped(error?: unknown) {
  return error instanceof ReplayStoppedError || replayContext.getStore()?.signal?.aborted === true;
}

function throwIfReplayStopped(error?: unknown) {
  if (isReplayStopped(error)) throw new ReplayStoppedError();
  // 驱动失去响应不是“元素不存在”，不能被备用定位或可选步骤吞掉。
  if (error instanceof AppiumRequestTimeoutError || error instanceof AppiumServiceError) throw error;
}

function errorDetail(error: unknown) {
  if (!(error instanceof Error)) return String(error || '未知错误');
  const cause = error.cause;
  if (cause instanceof Error && cause.message && cause.message !== error.message) {
    return `${error.message}：${cause.message}`;
  }
  return error.message;
}

function isTimeoutError(error: unknown) {
  const detail = errorDetail(error).toLowerCase();
  return detail.includes('timeout') || detail.includes('timed out');
}

function isStaleElementError(error: unknown) {
  const detail = errorDetail(error);
  return detail.includes('stale element reference') || detail.includes('does not exist in DOM anymore');
}

function wait(ms: number) {
  const signal = replayContext.getStore()?.signal;
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, ms));
  throwIfReplayStopped();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ReplayStoppedError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function normalizeTextForContains(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function adbTap(deviceId: string, x: number, y: number) {
  throwIfReplayStopped();
  return new Promise<void>((resolve, reject) => {
    execFile(getAdbCommand(), ['-s', deviceId, 'shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))], { timeout: 10000, signal: replayContext.getStore()?.signal }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve();
    });
  });
}

export function launchAppOnDevice(deviceId: string, packageName: string, signal = replayContext.getStore()?.signal) {
  signal?.throwIfAborted();
  if (!packageName) return Promise.reject(new Error('启动 APP 缺少包名'));
  return new Promise<void>((resolve, reject) => {
    execFile(getAdbCommand(), [
      '-s',
      deviceId,
      'shell',
      'monkey',
      '-p',
      packageName,
      '-c',
      'android.intent.category.LAUNCHER',
      '1',
    ], { maxBuffer: 4 * 1024 * 1024, timeout: 30000, signal }, (error, stdout, stderr) => {
      const output = `${stdout || ''}\n${stderr || ''}`.trim();
      if (error || /no activities found|monkey aborted/i.test(output)) {
        reject(new Error(output || error?.message || `ADB 启动 ${packageName} 失败`));
        return;
      }
      resolve();
    });
  });
}

export function clearAppDataOnDevice(deviceId: string, packageName: string, signal = replayContext.getStore()?.signal) {
  signal?.throwIfAborted();
  if (!packageName) return Promise.reject(new Error('清理 App 缓存缺少包名'));
  return new Promise<void>((resolve, reject) => {
    execFile(getAdbCommand(), [
      '-s',
      deviceId,
      'shell',
      'pm',
      'clear',
      packageName,
    ], { maxBuffer: 4 * 1024 * 1024, timeout: 30000, signal }, (error, stdout, stderr) => {
      const output = `${stdout || ''}\n${stderr || ''}`.trim();
      if (error || !/^success$/im.test(output)) {
        reject(new Error(output || error?.message || `ADB 清理 ${packageName} 失败`));
        return;
      }
      resolve();
    });
  });
}

function adbSwipe(deviceId: string, step: Required<AppiumRecordedStepRecord>['swipe']) {
  throwIfReplayStopped();
  return new Promise<void>((resolve, reject) => {
    execFile(getAdbCommand(), [
      '-s',
      deviceId,
      'shell',
      'input',
      'swipe',
      String(Math.round(step.startX)),
      String(Math.round(step.startY)),
      String(Math.round(step.endX)),
      String(Math.round(step.endY)),
      String(Math.round(step.duration)),
    ], { timeout: Math.max(10000, step.duration + 5000), signal: replayContext.getStore()?.signal }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve();
    });
  });
}

function adbText(deviceId: string, args: string[], strict = false) {
  return new Promise<string>((resolve, reject) => {
    execFile(getAdbCommand(), ['-s', deviceId, ...args], { maxBuffer: 4 * 1024 * 1024, timeout: 10000, signal: replayContext.getStore()?.signal }, (error, stdout, stderr) => {
      if (strict && error) { reject(new AppiumServiceError(`读取设备状态失败：${stderr || error.message}`)); return; }
      resolve((stdout || stderr || '').trim());
    });
  });
}

async function getCurrentActivity(deviceId: string) {
  const output = await adbText(deviceId, ['shell', 'dumpsys', 'activity', 'activities'], true);
  const resumedLine = output
    .split(/\r?\n/)
    .find((line) => /(?:topResumedActivity|ResumedActivity|mResumedActivity)/.test(line));
  return resumedLine?.match(/\s([\w.$]+\/[\w.$]+)\s/)?.[1] || '';
}

async function isAppInForeground(deviceId: string, packageName: string) {
  if (!packageName) return false;
  const currentActivity = await getCurrentActivity(deviceId);
  return currentActivity.split('/')[0] === packageName;
}

async function waitForActivity(deviceId: string, step: AppiumRecordedStepRecord) {
  const expectedActivity = step.value || '';
  if (!expectedActivity) throw new Error(`${step.label} 缺少目标 Activity`);
  const startedAt = Date.now();
  const timeoutMs = step.timeoutMs ?? DEFAULT_NODE_TIMEOUT_MS;
  let currentActivity = '';
  while (Date.now() - startedAt <= timeoutMs) {
    throwIfReplayStopped();
    currentActivity = await getCurrentActivity(deviceId);
    if (currentActivity === expectedActivity) return;
    await wait(500);
  }
  throw new ConditionTimeoutError(`${step.label} 等待超时，当前 Activity：${currentActivity || '-'}`);
}

async function appendSettingsDiagnostics(lines: string[], deviceId: string) {
  const packageInfo = await adbText(deviceId, ['shell', 'dumpsys', 'package', 'io.appium.settings']);
  const launchInfo = await adbText(deviceId, ['shell', 'am', 'start-activity', '-n', 'io.appium.settings/.Settings', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER']);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const serviceInfo = await adbText(deviceId, ['shell', 'dumpsys', 'activity', 'services', 'io.appium.settings']);
  lines.push('Appium Settings 诊断：');
  lines.push(`- 安装状态：${packageInfo.includes('Package [io.appium.settings]') ? '已安装' : '未检测到 io.appium.settings'}`);
  lines.push(`- 手动启动：${launchInfo || '-'}`);
  lines.push(`- 服务状态：${serviceInfo || '-'}`);
}

function appendAndroidSdkDiagnostics(lines: string[]) {
  lines.push('Android SDK 环境变量未配置：');
  lines.push('- 可在本项目“参数配置 > 运行配置”中指定 Android SDK 路径。');
  lines.push('- Windows 常见 SDK 路径：%LOCALAPPDATA%\\Android\\Sdk');
  lines.push('- PowerShell 设置示例：');
  lines.push('  [Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\\Android\\Sdk", "User")');
  lines.push('  [Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", "$env:LOCALAPPDATA\\Android\\Sdk", "User")');
  lines.push('  [Environment]::SetEnvironmentVariable("Path", $env:Path + ";$env:LOCALAPPDATA\\Android\\Sdk\\platform-tools", "User")');
  lines.push('- Appium 是独立进程时不会继承网页中后设置的环境变量；设置后请重新打开终端，并重启 appium 服务。');
}

async function appiumRequest<T>(
  path: string,
  init?: RequestInit,
  options?: { ignoreAbort?: boolean; timeoutMs?: number },
) {
  const requestUrl = `${appiumServerUrl()}${path}`;
  const context = replayContext.getStore();
  const method = init?.method || 'GET';
  const startedAt = Date.now();
  if (!options?.ignoreAbort) throwIfReplayStopped();
  context?.appiumLog(`[Appium] 请求：${method} ${path}`);
  let response: Response;
  let responseText: string;
  try {
    const result = await timedAppiumFetch(requestUrl, {
      ...init,
      signal: options?.ignoreAbort ? undefined : (context?.signal && init?.signal
        ? AbortSignal.any([context.signal, init.signal]) : context?.signal || init?.signal),
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    }, options?.timeoutMs ?? (path === '/session' && method === 'POST' ? 120000 : 30000));
    response = result.response;
    responseText = result.text;
  } catch (error) {
    if (isReplayStopped(error) && !options?.ignoreAbort) {
      context?.appiumLog(`[Appium] 取消：${method} ${path}`);
      throw new ReplayStoppedError();
    }
    context?.appiumLog(`[Appium] 异常：${method} ${path}（${errorDetail(error)}）`);
    if (error instanceof AppiumRequestTimeoutError) throw error;
    if (isTimeoutError(error)) {
      throw new AppiumServiceError(`Appium 请求超时 ${requestUrl}，${errorDetail(error)}`);
    }
    throw new AppiumServiceError(`无法连接 Appium 服务 ${requestUrl}，${errorDetail(error)}`);
  }

  context?.appiumLog(`[Appium] 响应：HTTP ${response.status} ${method} ${path}（${Date.now() - startedAt}ms）`);
  const payload = (() => {
    try {
      return responseText ? JSON.parse(responseText) : {};
    } catch {
      return {};
    }
  })() as T & {
    value?: { error?: string; message?: string; stacktrace?: string };
    error?: string;
    message?: string;
    stacktrace?: string;
  };
  if (!response.ok) {
    const detail = [
      payload.value?.error || payload.error ? `错误类型：${payload.value?.error || payload.error}` : '',
      payload.value?.message || payload.message ? `错误信息：${payload.value?.message || payload.message}` : '',
      payload.value?.stacktrace || payload.stacktrace ? `堆栈信息：\n${payload.value?.stacktrace || payload.stacktrace}` : '',
      responseText ? `原始响应：\n${responseText}` : '',
    ].filter(Boolean).join('\n');
    const ErrorType = ['no such element', 'stale element reference'].includes(payload.value?.error || payload.error || '') ? Error : AppiumServiceError;
    throw new ErrorType(`Appium ${method} ${path} 失败（HTTP ${response.status}）：\n${detail || '未返回错误详情'}`);
  }
  return payload;
}

function replayFrameSelector(step: AppiumRecordedStepRecord) {
  if (step.type === 'textClick') return `${step.flow?.textMatch === 'exact' ? '精准匹配' : '模糊匹配'}：${step.value || ''}`;
  const selector = step.selector;
  if (!selector) return '-';
  if (selector.strategy === 'bounds') return `bounds (${selector.centerX ?? '-'}, ${selector.centerY ?? '-'})`;
  return `${selector.strategy} ${selector.value || ''}`.trim();
}

async function captureReplayFrame(
  _sessionId: string,
  step: AppiumRecordedStepRecord,
  nodeNumber: number,
  scriptName: string,
  phase: AppiumReplayFrame['phase'],
  status: string,
  imageBase64?: string,
) {
  const context = replayContext.getStore();
  if (!context || !context.deviceId) return;
  const capturedAt = new Date().toISOString();
  // 执行记录独立于截图，设备截图失败不能让失败节点从统计中消失。
  context.historyEvents.push({ sequence: context.historyEvents.length + 1, scriptName, nodeId: step.id,
    nodeNumber, nodeLabel: step.label, nodeType: step.type, note: step.note || '',
    selector: replayFrameSelector(step), phase, status, capturedAt, imageBase64: '' });
  const appendFrame = (imageBase64: string) => {
    context.frames.push({
      sequence: context.frames.length + 1,
      scriptName,
      nodeId: step.id,
      nodeNumber,
      nodeLabel: step.label,
      nodeType: step.type,
      logContent: step.type === 'log' && phase === 'after' ? formatStageLog(resolveVariableStep(step)) : undefined,
      note: step.note || '',
      selector: replayFrameSelector(step),
      phase,
      status,
      capturedAt,
      imageBase64,
    });
  };

  // 关闭报告截图时仍保留时间锚点；视觉比较所需的结束帧不能省略。
  if (!context.screenshotReport && !(phase === 'after' && context.visualCaptureNodes.has(step.id))) {
    appendFrame('');
    return;
  }
  if (phase === 'stopped' && context.signal?.aborted) {
    const previousFrame = context.frames.at(-1);
    if (previousFrame) appendFrame(previousFrame.imageBase64);
    return;
  }

  try {
    // Report screenshots use ADB so a slow capture cannot block Appium's command queue.
    appendFrame(imageBase64 || await adbScreenshotBase64(context.deviceId));
  } catch (error) {
    context.appiumLog(`[节点 ${nodeNumber}] 截图失败：${errorDetail(error)}`);
    // 截图失败仍保留时间锚点，报告可定位到该节点的录像。
    appendFrame('');
  }
}

async function createSession(deviceId: string) {
  const payload = await appiumRequest<AppiumSessionResponse>('/session', {
    method: 'POST',
    body: JSON.stringify({
      capabilities: {
        alwaysMatch: {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:udid': deviceId,
          'appium:autoLaunch': false,
          'appium:noReset': true,
          // 托管进程由 finally 释放；外部服务保留回收期限，避免创建请求取消后遗留永久会话。
          'appium:newCommandTimeout': usesManagedAppiumServer() ? 0 : 60,
          'appium:skipDeviceInitialization': true,
          'appium:ignoreHiddenApiPolicyError': true,
        },
      },
    }),
  });
  const sessionId = payload.value?.sessionId || payload.sessionId || '';
  if (!sessionId) throw new Error('Appium 未返回 sessionId');
  return sessionId;
}

function isUiAutomationDisconnected(error: unknown) {
  return errorDetail(error).includes('UiAutomation not connected');
}

async function resetUiAutomator2(deviceId: string) {
  await adbText(deviceId, ['shell', 'pkill', '-f', 'com.android.commands.uiautomator.Launcher']);
  await adbText(deviceId, ['shell', 'am', 'force-stop', 'io.appium.uiautomator2.server']);
  await adbText(deviceId, ['shell', 'am', 'force-stop', 'io.appium.uiautomator2.server.test']);
  await wait(800);
}

function toAppiumUsing(selector: NonNullable<AppiumRecordedStepRecord['selector']>) {
  if (selector.strategy === 'accessibilityId') return { using: 'accessibility id', value: selector.value || '' };
  if (selector.strategy === 'id') return { using: 'id', value: selector.value || '' };
  if (selector.strategy === 'androidUiAutomator') return { using: '-android uiautomator', value: selector.value || '' };
  if (selector.strategy === 'xpath') return { using: 'xpath', value: selector.value || '' };
  throw new Error('需要使用 bounds 坐标执行');
}

async function findElementBySelector(
  sessionId: string,
  selector: NonNullable<AppiumRecordedStepRecord['selector']>,
  parentElementId?: string,
) {
  const using = toAppiumUsing(selector);
  const path = parentElementId
    ? `/session/${sessionId}/element/${parentElementId}/element`
    : `/session/${sessionId}/element`;
  const payload = await appiumRequest<AppiumElementResponse>(path, {
    method: 'POST',
    body: JSON.stringify(using),
  });
  const elementId = payload.value?.[ELEMENT_KEY] || payload.value?.ELEMENT || '';
  if (!elementId) throw new Error('未找到元素');
  return elementId;
}

async function findElement(sessionId: string, step: AppiumRecordedStepRecord, timeoutMs = step.timeoutMs ?? DEFAULT_NODE_TIMEOUT_MS) {
  return withElementDeadline(timeoutMs, () => findElementWithinDeadline(sessionId, step));
}

async function findElementWithinDeadline(sessionId: string, step: AppiumRecordedStepRecord) {
  if (!step.selector) throw new Error(`${step.label} 缺少 selector`);
  const attempts: string[] = [];

  if (step.contextSelector) {
    try {
      attempts.push(`context ${step.contextSelector.strategy} ${step.contextSelector.value || ''} -> ${step.selector.strategy} ${step.selector.value || ''}`);
      const parentId = await findElementBySelector(sessionId, step.contextSelector);
      return await findElementBySelector(sessionId, step.selector, parentId);
    } catch (error) {
      throwIfReplayStopped(error);
      // Continue with the fallback chain below.
    }
  }

  // 唯一原生定位优先；非唯一元素仍保留父级与备用 XPath 的精确匹配。
  const preferPrimary = step.selector.unique === true && ['id', 'accessibilityId'].includes(step.selector.strategy);
  for (const selector of [...(preferPrimary ? [step.selector] : []), ...(step.selectorChain || [])]) {
    try {
      attempts.push(`${selector.strategy} ${selector.value || ''}`);
      return await findElementBySelector(sessionId, selector);
    } catch (error) {
      throwIfReplayStopped(error);
      // Continue.
    }
  }

  try {
    attempts.push(`${step.selector.strategy} ${step.selector.value || ''}`);
    return await findElementBySelector(sessionId, step.selector);
  } catch (error) {
    throwIfReplayStopped(error);
    throw new Error(`${step.label} 未找到元素；尝试过：${attempts.filter(Boolean).join('；') || '-'}；${errorDetail(error)}`);
  }
}

// 图像判断不能使用通用定位的“第一个匹配”及坐标回退，父级和子级均须唯一。
async function imageCheckRegion(sessionId: string, step: AppiumRecordedStepRecord) {
  async function unique(selector: AppiumRecordedStepRecord['selector'], parent?: string) {
    if (!selector || selector.strategy === 'bounds') throw new Error('缺少可唯一定位的组件信息');
    const path = parent ? `/session/${sessionId}/element/${parent}/elements` : `/session/${sessionId}/elements`;
    const payload = await appiumRequest<AppiumValueResponse<Array<Record<string, string>>>>(path, {
      method: 'POST', body: JSON.stringify(toAppiumUsing(selector)),
    });
    if (payload.value?.length !== 1) throw new Error(`目标组件匹配 ${payload.value?.length || 0} 个，请限定父级或条目文字`);
    const id = payload.value[0]?.[ELEMENT_KEY] || payload.value[0]?.ELEMENT;
    if (!id) throw new Error('目标组件缺少元素标识');
    return id;
  }
  const parent = step.contextSelector ? await unique(step.contextSelector) : undefined;
  const id = await unique(step.selector, parent);
  const rect = await appiumRequest<AppiumValueResponse<VisualChangeRegion>>(`/session/${sessionId}/element/${id}/rect`);
  if (!rect.value) throw new Error('无法读取组件实时区域');
  return rect.value;
}

async function tapFallback(deviceId: string, step: AppiumRecordedStepRecord) {
  if (step.fallback?.strategy !== 'bounds' || !Number.isFinite(step.fallback.centerX) || !Number.isFinite(step.fallback.centerY)) {
    throw new Error(`${step.label} 未找到元素，且没有可用坐标兜底`);
  }
  await adbTap(deviceId, Number(step.fallback.centerX), Number(step.fallback.centerY));
}

async function waitForElement(sessionId: string, step: AppiumRecordedStepRecord) {
  const startedAt = Date.now();
  const timeoutMs = step.timeoutMs ?? DEFAULT_NODE_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      return await findElement(sessionId, step, Math.max(1, timeoutMs - (Date.now() - startedAt)));
    } catch (error) {
      throwIfReplayStopped(error);
      lastError = error;
      await wait(500);
    }
  }
  throw new ConditionTimeoutError(`${step.label} 等待元素超时（${timeoutMs}ms）：${errorDetail(lastError)}`);
}

async function findOptionalElement(sessionId: string, step: AppiumRecordedStepRecord) {
  const startedAt = Date.now();
  const timeoutMs = step.timeoutMs ?? DEFAULT_NODE_TIMEOUT_MS;
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      return await findElement(sessionId, step, Math.max(1, timeoutMs - (Date.now() - startedAt)));
    } catch (error) {
      throwIfReplayStopped(error);
      await wait(250);
    }
  }
  return '';
}

async function waitForElementGone(sessionId: string, step: AppiumRecordedStepRecord) {
  const startedAt = Date.now();
  const timeoutMs = step.timeoutMs ?? DEFAULT_NODE_TIMEOUT_MS;
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      await findElement(sessionId, step, Math.max(1, timeoutMs - (Date.now() - startedAt)));
    } catch (error) {
      throwIfReplayStopped(error);
      return;
    }
    await wait(500);
  }
  throw new ConditionTimeoutError(`${step.label} 等待消失超时`);
}

async function saveScreenshot(deviceId: string) {
  if (variableContext.getStore()?.privacy.enabled) return;
  const dir = appDataPath('.midscene-app', 'screenshots');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `appium-${Date.now()}.png`);
  await writeFile(file, Buffer.from(await adbScreenshotBase64(deviceId), 'base64'));
}

type RunStepMeta = {
  onModelOutput?: (content: string) => void;
  onAiProgress?: (message: string) => void;
  nodeNumber: number;
  scriptName: string;
  frameStart?: number;
};

type RunStepResult = string | {
  message?: string;
  softFailed?: boolean;
};

function completedStepStatus(step: AppiumRecordedStepRecord, softFailed: boolean) {
  if (step.type === 'endFlow') return '流程已结束';
  if (step.type === 'visualChange') {
    if (step.visualChange?.role === 'start') return '已记录基准帧';
    if (step.visualChange?.role === 'end') return '已记录对比帧';
  }
  return softFailed ? '视觉变化未达预期' : '成功';
}

function visualChangeNumber(value: unknown, fallback: number, min: number, max = Number.POSITIVE_INFINITY) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function visualChangeRegion(step: AppiumRecordedStepRecord): VisualChangeRegion {
  const config = step.visualChange;
  if (!config?.region) throw new Error(`${step.label} 缺少检测区域`);
  return {
    x: Math.max(0, Math.round(Number(config.region.x) || 0)),
    y: Math.max(0, Math.round(Number(config.region.y) || 0)),
    width: Math.max(1, Math.round(Number(config.region.width) || 1)),
    height: Math.max(1, Math.round(Number(config.region.height) || 1)),
  };
}

function findVisualFrame(
  frames: AppiumReplayFrame[],
  nodeId: string,
  scriptName: string,
  preferredPhase: AppiumReplayFrame['phase'],
) {
  const matches = frames.filter((frame) => frame.nodeId === nodeId && frame.scriptName === scriptName);
  if (!matches.length) return undefined;
  const frame = preferredPhase === 'before' ? matches[0] : matches[matches.length - 1];
  // A failed capture must not fall back to an older round or a before/error image.
  return frame?.phase === preferredPhase ? frame : undefined;
}

const EMPTY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function registerVisualChangeStep(
  step: AppiumRecordedStepRecord,
  meta: RunStepMeta,
): RunStepResult {
  const config = step.visualChange;
  if (!config) throw new Error(`${step.label} 缺少画面变化检测配置`);
  const context = replayContext.getStore();
  if (config.role === 'start') {
    // Invalidate the previous capture even when this start's after screenshot fails.
    context?.visualStartOffsets.set(JSON.stringify([meta.frameStart || 0, step.id]), context.frames.length);
    return {
      message: `已记录画面变化基准点：${config.pairLabel || step.label}`,
    };
  }
  const endStep = {
    ...step,
    visualChange: {
      ...config,
      endStepId: config.endStepId || step.id,
    },
  };
  context?.pendingVisualChecks.push({ step: endStep, nodeNumber: meta.nodeNumber, scriptName: meta.scriptName,
    frameStart: context.visualStartOffsets.get(JSON.stringify([meta.frameStart || 0, config.startStepId])) ?? meta.frameStart ?? 0,
    endFrameStart: context.frames.length });
  return {
    message: `已记录画面变化对比点：${config.pairLabel || step.label}`,
  };
}

function appendVisualCheckFailure(lines: string[], check: PendingVisualChangeCheck, message: string) {
  const context = replayContext.getStore();
  if (context) {
    const config = check.step.visualChange;
    context.softFailureCount += 1;
    context.visualChecks.push({
      nodeId: check.step.id,
      nodeNumber: check.nodeNumber,
      nodeLabel: check.step.label,
      status: 'failed',
      message,
      region: config?.region ? visualChangeRegion(check.step) : { x: 0, y: 0, width: 1, height: 1 },
      durationMs: 0,
      intervalMs: 0,
      sampleCount: 0,
      changeRatioThreshold: visualChangeNumber(config?.changeRatioThreshold, 2, 0.01),
      maxChangeRatio: 0,
      baselineBase64: EMPTY_PNG_BASE64,
      comparisonBase64: EMPTY_PNG_BASE64,
      diffBase64: EMPTY_PNG_BASE64,
      startNodeId: config?.startStepId,
      endNodeId: config?.endStepId,
    });
  }
  lines.push(`[节点 ${check.nodeNumber}] 视觉变化检测异常：${message}（继续执行）`);
}

function processPendingVisualChecks(lines: string[]) {
  const context = replayContext.getStore();
  if (!context || !context.pendingVisualChecks.length) return;

  // Resolve each pair immediately after its end capture, before later rounds
  // or linked-script calls can replace the images associated with these IDs.
  context.pendingVisualChecks.forEach((check) => {
    const config = check.step.visualChange;
    if (!config?.startStepId || !config.endStepId) {
      appendVisualCheckFailure(lines, check, `${check.step.label} 缺少开始节点或结束节点`);
      return;
    }
    const baselineFrame = findVisualFrame(context.frames.slice(check.frameStart, check.endFrameStart), config.startStepId, check.scriptName, 'after');
    const comparisonFrame = findVisualFrame(context.frames.slice(check.endFrameStart), config.endStepId, check.scriptName, 'after');
    if (!baselineFrame || !comparisonFrame) {
      const missing = [
        baselineFrame ? '' : '开始节点截图',
        comparisonFrame ? '' : '结束节点截图',
      ].filter(Boolean).join('、');
      appendVisualCheckFailure(lines, check, `${check.step.label} 未捕获到${missing}`);
      return;
    }
    let result: ReturnType<typeof compareVisualChangeFrames>;
    try {
      result = compareVisualChangeFrames({
        baselineScreenshot: Buffer.from(baselineFrame.imageBase64, 'base64'),
        comparisonScreenshot: Buffer.from(comparisonFrame.imageBase64, 'base64'),
        region: visualChangeRegion(check.step),
        changeRatioThreshold: visualChangeNumber(config.changeRatioThreshold, 2, 0.01),
        pixelmatchThreshold: visualChangeNumber(config.pixelmatchThreshold, 0.1, 0, 1),
      });
    } catch (error) {
      appendVisualCheckFailure(lines, check, `${check.step.label} 对比失败：${errorDetail(error)}`);
      return;
    }
    context.visualChecks.push({
      nodeId: check.step.id,
      nodeNumber: check.nodeNumber,
      nodeLabel: check.step.label,
      status: result.passed ? 'passed' : 'failed',
      message: result.message,
      region: result.region,
      durationMs: result.durationMs,
      intervalMs: result.intervalMs,
      sampleCount: result.sampleCount,
      changeRatioThreshold: result.changeRatioThreshold,
      maxChangeRatio: result.maxChangeRatio,
      baselineBase64: result.baselineBase64,
      comparisonBase64: result.comparisonBase64,
      diffBase64: result.diffBase64,
      startNodeId: config.startStepId,
      startNodeLabel: `${baselineFrame.nodeNumber}. ${baselineFrame.nodeLabel}`,
      endNodeId: config.endStepId,
      endNodeLabel: `${comparisonFrame.nodeNumber}. ${comparisonFrame.nodeLabel}`,
    });
    if (!result.passed) context.softFailureCount += 1;
    lines.push(`[节点 ${check.nodeNumber}] 视觉变化检测${result.passed ? '有变化' : '无明显变化'}：${result.message}${result.passed ? '' : '（继续执行）'}`);
  });
  context.pendingVisualChecks = [];
}

async function runStep(
  sessionId: string,
  deviceId: string,
  step: AppiumRecordedStepRecord,
  meta: RunStepMeta,
): Promise<RunStepResult | void> {
  throwIfReplayStopped();
  step = resolveVariableStep(step);
  if (step.type === 'aiRecognition') {
    const recognition = await recognizeDeviceScreen({
      deviceId, prompt: step.value, aiBranchEnabled: step.aiBranchEnabled, aiObservation: step.aiObservation,
      onProgress: meta.onAiProgress,
      onObservationFrame: frame => captureReplayFrame(sessionId, step, meta.nodeNumber, meta.scriptName || '', 'observation', `观察第 ${frame.index} 帧 · ${frame.elapsedMs}ms`, frame.imageBase64),
      timeoutMs: step.timeoutMs, aiTimeoutEnabled: step.aiTimeoutEnabled === true,
      signal: replayContext.getStore()?.signal, onModelOutput: meta.onModelOutput,
    });
    return `AI 识别回答：${recognition.reason}`;
  }
  if (step.type === 'extractVariable') {
    const config = validateExtraction(step.extractVariable);
    const scope = variableContext.getStore();
    if (!scope) throw new Error('变量作用域未初始化');
    const elementId = await findElement(sessionId, step);
    const endpoint = config.attribute === 'text' ? 'text' : `attribute/${encodeURIComponent(config.attribute)}`;
    const payload = await appiumRequest<AppiumValueResponse<unknown>>(`/session/${sessionId}/element/${elementId}/${endpoint}`);
    if (payload.value === null || payload.value === undefined) throw new Error(`组件不存在属性：${config.attribute}`);
    scope.set({ name: config.name, value: String(payload.value), sensitive: config.sensitive }, true);
    return `已提取变量：${config.name}`;
  }
  if (step.type === 'delay') {
    await wait(Math.max(0, step.timeoutMs || 1000));
    return;
  }

  if (step.type === 'waitActivity') {
    await waitForActivity(deviceId, step);
    return;
  }

  if (step.type === 'key') {
    await appiumRequest(`/session/${sessionId}/appium/device/press_keycode`, {
      method: 'POST',
      body: JSON.stringify({ keycode: step.keyCode || 4 }),
    });
    return;
  }

  if (step.type === 'launchApp') {
    const packageName = step.value || '';
    if (await isAppInForeground(deviceId, packageName).catch(error => { throwIfReplayStopped(error); return false; })) {
      return `APP 已在前台，跳过启动 ${packageName}`;
    }
    await launchAppOnDevice(deviceId, packageName);
    return `ADB 已启动 ${packageName}`;
  }

  if (step.type === 'stopApp') {
    return stopAppOnDevice(deviceId, step.value || '', replayContext.getStore()?.signal);
  }

  if (step.type === 'clearAppData') {
    const packageName = step.value || '';
    await clearAppDataOnDevice(deviceId, packageName);
    return `ADB 已清除 ${packageName} 的应用数据与缓存`;
  }

  if (step.type === 'screenshot') {
    await saveScreenshot(deviceId);
    return;
  }

  if (step.type === 'visualChange') {
    return registerVisualChangeStep(step, meta);
  }

  if (step.type === 'noop') {
    return;
  }
  if (step.type === 'log') return formatStageLog(step);
  if (step.type === 'openGallery') return openGalleryOnDevice(deviceId, replayContext.getStore()?.signal);
  if (step.type === 'endFlow') {
    // 同一次回放的主脚本和连接脚本共享结束状态，不影响下一次回放。
    const context = replayContext.getStore();
    if (context) context.flowEnded = true;
    return '流程已主动结束，后续节点不再执行';
  }

  if (step.type === 'coordinateTap') {
    await tapFallback(deviceId, step);
    return;
  }

  if (step.type === 'swipe') {
    if (!step.swipe) throw new Error(`${step.label} 缺少滑动坐标`);
    await adbSwipe(deviceId, step.swipe);
    return;
  }

  if (step.type === 'longPress') {
    const error = validateLongPress(step);
    if (error) throw new Error(`${step.label}：${error}`);
    const duration = step.timeoutMs ?? 800;
    if (longPressMode(step) === 'element') {
      const elementId = await findElement(sessionId, step);
      await appiumRequest(`/session/${sessionId}/execute/sync`, {
        method: 'POST',
        body: JSON.stringify({ script: 'mobile: longClickGesture', args: [{ elementId, duration }] }),
      });
      return `已长按元素 ${duration}ms`;
    }
    const x = Number(step.fallback!.centerX);
    const y = Number(step.fallback!.centerY);
    await adbSwipe(deviceId, { startX: x, startY: y, endX: x, endY: y, duration });
    return `已长按坐标 ${x},${y} ${duration}ms`;
  }

  if (step.type === 'pinch') {
    if (!step.pinch) throw new Error(`${step.label} 缺少缩放参数`);
    const size = Math.round(Math.min(500, Math.max(120, step.pinch.centerX, step.pinch.centerY)));
    await appiumRequest(`/session/${sessionId}/execute/sync`, {
      method: 'POST',
      body: JSON.stringify({
        script: step.pinch.direction === 'out' ? 'mobile: pinchOpenGesture' : 'mobile: pinchCloseGesture',
        args: [{
          left: Math.max(0, Math.round(step.pinch.centerX - size / 2)),
          top: Math.max(0, Math.round(step.pinch.centerY - size / 2)),
          width: size,
          height: size,
          percent: step.pinch.percent,
        }],
      }),
    });
    return;
  }

  if (step.type === 'waitDisappear') {
    await waitForElementGone(sessionId, step);
    return;
  }

  if (step.type === 'tapIfExists') {
    const elementId = await findOptionalElement(sessionId, step);
    if (!elementId) return '未出现，已跳过';
    await appiumRequest(`/session/${sessionId}/element/${elementId}/click`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return '已出现，已点击';
  }

  if (step.type === 'inputIfExists') {
    const elementId = await findOptionalElement(sessionId, step);
    if (!elementId) return '未出现，已跳过';
    await appiumRequest(`/session/${sessionId}/element/${elementId}/value`, {
      method: 'POST',
      body: JSON.stringify({ text: step.value || '', value: [...(step.value || '')] }),
    });
    return '已出现，已输入';
  }

  if (step.type === 'clearIfExists') {
    const elementId = await findOptionalElement(sessionId, step);
    if (!elementId) return '未出现，已跳过';
    await appiumRequest(`/session/${sessionId}/element/${elementId}/clear`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return '已出现，已清空';
  }

  if (step.type === 'backIfExists') {
    const elementId = await findOptionalElement(sessionId, step);
    if (!elementId) return '未出现，已跳过';
    await appiumRequest(`/session/${sessionId}/appium/device/press_keycode`, {
      method: 'POST',
      body: JSON.stringify({ keycode: 4 }),
    });
    return '已出现，已返回';
  }

  if (step.type === 'waitFor' || step.type === 'assertExists') {
    await waitForElement(sessionId, step);
    return;
  }

  if (step.type === 'assertText') {
    const elementId = await findElement(sessionId, step);
    const payload = await appiumRequest<AppiumValueResponse<string>>(`/session/${sessionId}/element/${elementId}/text`);
    const actual = payload.value || '';
    if (!actual.includes(step.value || '')) throw new Error(`${step.label} 不匹配，实际文本：${actual || '-'}`);
    return;
  }

  if (step.type === 'tap') {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const elementId = await findElement(sessionId, step);
        await appiumRequest(`/session/${sessionId}/element/${elementId}/click`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        return;
      } catch (error) {
        throwIfReplayStopped(error);
        if (attempt === 0 && isStaleElementError(error)) {
          await wait(300);
          continue;
        }
        await tapFallback(deviceId, step);
        return;
      }
    }
    return;
  }

  if (step.type === 'input') {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const elementId = await findElement(sessionId, step);
        await appiumRequest(`/session/${sessionId}/element/${elementId}/value`, {
          method: 'POST',
          body: JSON.stringify({ text: step.value || '', value: [...(step.value || '')] }),
        });
        return;
      } catch (error) {
        throwIfReplayStopped(error);
        if (attempt === 0 && isStaleElementError(error)) {
          await wait(300);
          continue;
        }
        throw error;
      }
    }
  }

  if (step.type === 'clearInput') {
    const elementId = await findElement(sessionId, step);
    await appiumRequest(`/session/${sessionId}/element/${elementId}/clear`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }
}

async function readNativeControlState(sessionId: string, step: AppiumRecordedStepRecord) {
  if (!isNativeStateCondition(step)) throw new Error('不是原生控件状态判断节点');
  const elementId = await waitForElement(sessionId, step);
  const attribute = async (name: string) => (
    await appiumRequest<AppiumValueResponse<unknown>>(`/session/${sessionId}/element/${elementId}/attribute/${name}`)
  ).value;
  const className = await attribute('className');
  if (!matchesNativeControl(step.type, className)) {
    throw new Error(`${step.label} 目标不是原生 ${nativeControlName(step.type)}，实际类型：${String(className ?? '未知')}`);
  }
  if (parseNativeBoolean(await attribute('checkable')) !== true) {
    throw new Error(`${step.label} 目标不支持原生勾选状态（checkable 不为 true）`);
  }
  const checked = parseNativeBoolean(await attribute('checked'));
  if (checked === undefined) throw new Error(`${step.label} 无法读取有效的 checked 属性`);
  return checked;
}

async function evaluateCondition(sessionId: string, deviceId: string, step: AppiumRecordedStepRecord) {
  step = resolveVariableStep(step);
  if (step.type === 'loop') {
    if (step.loop?.exitWhen === 'never') return false;
    const selector = toAppiumUsing(step.selector!);
    const payload = await appiumRequest<AppiumValueResponse<Record<string, string>[]>>(`/session/${sessionId}/elements`, {
      method: 'POST', body: JSON.stringify(selector),
    });
    if (!Array.isArray(payload.value)) throw new Error('循环退出条件查询返回了无效结果');
    return step.loop?.exitWhen === 'exists' ? payload.value.length > 0 : payload.value.length === 0;
  }
  if (step.type === 'textClick') {
    const selector = textClickSelector(step);
    const deadline = Date.now() + Math.max(0, step.timeoutMs ?? DEFAULT_NODE_TIMEOUT_MS);
    // 查询空结果才是未匹配；通信错误、重复匹配和点击失败走现有异常处理。
    do {
      const payload = await appiumRequest<AppiumValueResponse<Record<string, string>[]>>(`/session/${sessionId}/elements`, {
        method: 'POST', body: JSON.stringify(selector),
      });
      if (!Array.isArray(payload.value)) throw new Error('文字点击查询返回了无效结果');
      if (payload.value.length > 1) throw new Error(`匹配到 ${payload.value.length} 个文字元素，请使用更精确的文字`);
      if (payload.value.length === 1) {
        const element = payload.value[0]!;
        const id = element[ELEMENT_KEY] || element.ELEMENT;
        if (!id) throw new Error('文字点击查询缺少元素 ID');
        await appiumRequest(`/session/${sessionId}/element/${id}/click`, { method: 'POST', body: '{}' });
        return true;
      }
      if (Date.now() >= deadline) {
        if (step.timeoutMs === 0) return false;
        throw new ConditionTimeoutError(`文字点击等待匹配超时（${step.timeoutMs ?? DEFAULT_NODE_TIMEOUT_MS}ms）`);
      }
      await wait(Math.max(0, Math.min(500, deadline - Date.now())));
    } while (true);
  }
  // 未找到控件、类型错误和属性读取异常不等于未勾选，必须交给回放错误处理。
  if (isNativeStateCondition(step)) return readNativeControlState(sessionId, step);
  try {
    if (step.type === 'waitActivity') {
      await waitForActivity(deviceId, step);
      return true;
    }
    if (step.type === 'waitDisappear') {
      await waitForElementGone(sessionId, step);
      return true;
    }
    if (step.type === 'assertText' || (step.type === 'assertExists' && step.value)) {
      const elementId = await waitForElement(sessionId, step);
      const payload = await appiumRequest<AppiumValueResponse<string>>(`/session/${sessionId}/element/${elementId}/text`);
      const actualText = payload.value || '';
      const expectedText = step.value || '';
      return step.flow?.textMatch === 'exact'
        ? actualText === expectedText
        : normalizeTextForContains(actualText).includes(normalizeTextForContains(expectedText));
    }
    await waitForElement(sessionId, step);
    return true;
  } catch (error) {
    throwIfReplayStopped(error);
    throw error;
  }
}

function hasFlowSteps(steps: AppiumRecordedStepRecord[]) {
  return steps.some((step) => (
    defaultFlowKind(step) === 'condition'
    || Boolean(step.flow?.yesTargetId)
    || Boolean(step.flow?.noTargetId)
    || Boolean(step.flow?.successTargetId)
    || Boolean(step.flow?.failureTargetId)
  ));
}

async function appendStepDiagnostics(lines: string[], deviceId: string, step: AppiumRecordedStepRecord) {
  const currentActivity = await getCurrentActivity(deviceId).catch(() => '');
  lines.push(`诊断 Activity：${currentActivity || '-'}`);
  lines.push(`诊断 selector：${step.selector ? `${step.selector.strategy} ${step.selector.value || ''}` : '-'}`);
  if (step.contextSelector) {
    lines.push(`诊断上下文：${step.contextSelector.strategy} ${step.contextSelector.value || ''}`);
  }
  if (step.selectorChain?.length) {
    lines.push(`诊断备用 selector：${step.selectorChain.map((selector) => `${selector.strategy} ${selector.value || ''}`).join('；')}`);
  }
  if (step.pageBefore) {
    lines.push(`录制前 Activity：${step.pageBefore.activity || '-'}`);
  }
  if (step.pageAfter) {
    lines.push(`录制后 Activity：${step.pageAfter.activity || '-'}`);
  }
}

type ReplayStepOptions = {
  frameStart?: number;
  skipAppInitialization?: boolean;
  scriptName?: string;
};

function shouldSkipLinkedScriptInitStep(options: ReplayStepOptions, step: AppiumRecordedStepRecord, steps: AppiumRecordedStepRecord[]) {
  if (!options.skipAppInitialization) return false;
  // Only the leading initialization sequence is redundant in a linked script.
  // Launches inside branches or after other operations are intentional actions.
  return steps.slice(0, steps.indexOf(step) + 1).every(item =>
    !item.flow?.parentConditionId && (item.type === 'launchApp' || item.type === 'clearAppData'));
}

function linkedScriptInitSkipReason(step: AppiumRecordedStepRecord) {
  return step.type === 'clearAppData'
    ? '连接脚本不重复清理 App'
    : '连接脚本不重复启动 App';
}

async function replayLinkedScript(
  sessionId: string,
  deviceId: string,
  step: AppiumRecordedStepRecord,
  lines: string[],
  stack: string[],
) {
  throwIfReplayStopped();
  const scriptId = step.value || '';
  if (!scriptId) throw new Error(`${step.label} 缺少连接脚本 ID`);
  if (stack.includes(scriptId)) throw new Error(`${step.label} 检测到循环连接脚本`);
  const linkedScript = replayContext.getStore()?.scripts.get(scriptId);
  if (!linkedScript) throw new Error(`${step.label} 指向的脚本不存在`);

  if (linkedScript.appActivity) {
    const currentActivity = await getCurrentActivity(deviceId).catch(() => '');
    if (currentActivity !== linkedScript.appActivity) {
      lines.push(`等待连接脚本入口 Activity：${linkedScript.appActivity}`);
      try {
        await waitForActivity(deviceId, {
          id: `${step.id}_wait_activity`,
          type: 'waitActivity',
          label: step.label,
          value: linkedScript.appActivity,
          timeoutMs: DEFAULT_NODE_TIMEOUT_MS,
        });
      } catch (error) {
        throwIfReplayStopped(error);
        const latestActivity = await getCurrentActivity(deviceId).catch(() => currentActivity);
        throw new Error(
          `${step.label} 无法执行：当前 Activity 为 ${latestActivity || '-'}，`
          + `目标脚本入口 Activity 为 ${linkedScript.appActivity}`,
        );
      }
    }
  }

  // 每次调用独立分段，即使连续两次连接的是同一个脚本。
  await replayContext.getStore()?.selectVideoScript?.(linkedScript.id, linkedScript.name, true);
  lines.push(`连接脚本开始：${linkedScript.name}`);
  const nextStack = [...stack, linkedScript.id];
  const parent = variableContext.getStore()!;
  const child = parent.child(linkedScript.variables || [], step.parameters);
  await variableContext.run(child, () => replayScriptSteps(sessionId, deviceId, linkedScript.steps, lines, nextStack, {
    skipAppInitialization: true, scriptName: linkedScript.name,
  }));
  if (!replayContext.getStore()?.flowEnded) parent.acceptReturns(child, step.returns);
  lines.push(`连接脚本完成：${linkedScript.name}`);
}

function appendRunStepResult(lines: string[], nodeNumber: number, result: RunStepResult | void) {
  if (!result) return false;
  if (typeof result === 'string') {
    if (result) lines.push(`[节点 ${nodeNumber}] 结果：${result}`);
    return false;
  }
  if (result.softFailed) {
    lines.push(`[节点 ${nodeNumber}] 视觉变化未达预期：${result.message || '未检测到明显变化'}（继续执行）`);
    return true;
  }
  if (result.message) lines.push(`[节点 ${nodeNumber}] 结果：${result.message}`);
  return false;
}

async function replayLinearSteps(
  sessionId: string,
  deviceId: string,
  steps: AppiumRecordedStepRecord[],
  lines: string[],
  stack: string[] = [],
  options: ReplayStepOptions = {},
) {
  for (const [index, step] of steps.entries()) {
    if (replayContext.getStore()?.flowEnded) return;
    throwIfReplayStopped();
    if (shouldSkipLinkedScriptInitStep(options, step, steps)) {
      lines.push(`[节点 ${index + 1}] 跳过：${step.label}（${linkedScriptInitSkipReason(step)}）`);
      continue;
    }
    await replayContext.getStore()?.selectVideoScript?.(stack.at(-1) || '', options.scriptName || '');
    lines.push(`[节点 ${index + 1}] 开始：${step.label}`);
    await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'before', '执行前');
    try {
      let softFailed = false;
      if (step.type === 'runScript') {
        await replayLinkedScript(sessionId, deviceId, step, lines, stack);
      } else {
        const result = await runStep(sessionId, deviceId, step, {
          onAiProgress: message => lines.push(`[节点 ${index + 1}] AI 持续观察：${message}`),
          onModelOutput: content => lines.push(`[节点 ${index + 1}] AI 识别模型输出：${content}`),
          nodeNumber: index + 1,
          scriptName: options.scriptName || '',
          frameStart: options.frameStart,
        });
        softFailed = appendRunStepResult(lines, index + 1, result);
      }
      lines.push(`[节点 ${index + 1}] 完成：${step.label}${softFailed ? '（存在软失败，已继续）' : ''}`);
      await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'after', completedStepStatus(step, softFailed));
      processPendingVisualChecks(lines);
    } catch (error) {
      if (isReplayStopped(error)) {
        lines.push(`[节点 ${index + 1}] 已终止：${step.label}`);
        await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'stopped', '已终止');
        throw new ReplayStoppedError();
      }
      lines.push(`[节点 ${index + 1}] 失败：${errorDetail(error)}`);
      await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'error', '失败');
      await appendStepDiagnostics(lines, deviceId, step);
      throw error;
    }
  }
}

async function replayFlowSteps(
  sessionId: string,
  deviceId: string,
  steps: AppiumRecordedStepRecord[],
  lines: string[],
  stack: string[] = [],
  options: ReplayStepOptions = {},
) {
  const idToIndex = new Map(steps.map((step, index) => [step.id, index]));
  const traversal = new BoundedLoopTraversal(steps);
  const nextIndexAfterStep = (index: number, step: AppiumRecordedStepRecord) => traversal.next(step, index);
  const visitedPath: string[] = [];
  let index: number | undefined = 0;

  while (typeof index === 'number' && index >= 0 && index < steps.length) {
    if (replayContext.getStore()?.flowEnded) return;
    throwIfReplayStopped();
    const step = steps[index];
    traversal.visit(step);
    const loopContext = traversal.context(step);
    const frameStep = loopContext ? { ...step, label: `${step.label}（${loopContext}）` } : step;
    if (shouldSkipLinkedScriptInitStep(options, step, steps)) {
      lines.push(`[节点 ${index + 1}] 跳过：${step.label}（${linkedScriptInitSkipReason(step)}）`);
      index = nextIndexAfterStep(index, step);
      continue;
    }
    await replayContext.getStore()?.selectVideoScript?.(stack.at(-1) || '', options.scriptName || '');
    visitedPath.push(step.label);
    const nodeKind = defaultFlowKind(step);
    lines.push(`[节点 ${index + 1}] 开始：${frameStep.label}`);
    await captureReplayFrame(sessionId, frameStep, index + 1, options.scriptName || '', 'before', '执行前');

    if (nodeKind === 'condition') {
      try {
        if (step.type === 'loop') {
          const iterations = traversal.iteration(step);
          const atLimit = iterations >= step.loop!.maxIterations;
          const exitMatched = !atLimit && await evaluateCondition(sessionId, deviceId, step);
          if (atLimit || exitMatched) {
            const reason = atLimit ? '达到最大次数' : '满足退出条件';
            lines.push(`[循环 ${step.label}] 结束：${reason}，已执行 ${iterations} 轮`);
            await captureReplayFrame(sessionId, frameStep, index + 1, options.scriptName || '', 'after', `${reason}，已执行 ${iterations} 轮`);
            index = traversal.exit(step);
          } else {
            const entered = traversal.enter(step);
            lines.push(`[循环 ${step.label}] 第 ${entered.iteration}/${step.loop!.maxIterations} 轮开始`);
            await captureReplayFrame(sessionId, frameStep, index + 1, options.scriptName || '', 'after', `第 ${entered.iteration}/${step.loop!.maxIterations} 轮`);
            index = entered.next;
          }
          continue;
        }
        const beforeFrame = replayContext.getStore()?.frames.at(-1);
        const recognition = step.type === 'aiRecognition' ? await recognizeDeviceScreen({
          deviceId, prompt: resolveVariableStep(step).value, timeoutMs: step.timeoutMs,
          aiTimeoutEnabled: step.aiTimeoutEnabled === true, aiObservation: step.aiObservation,
          onProgress: message => lines.push(`[节点 ${index + 1}] AI 持续观察：${message}`),
          onObservationFrame: frame => captureReplayFrame(sessionId, frameStep, index + 1, options.scriptName || '', 'observation', `观察第 ${frame.index} 帧 · ${frame.elapsedMs}ms`, frame.imageBase64),
          onModelOutput: (content) => lines.push(`[节点 ${index + 1}] AI 识别模型输出：${content}`),
          signal: replayContext.getStore()?.signal,
          imageBase64: beforeFrame?.nodeId === step.id && beforeFrame.phase === 'before' ? beforeFrame.imageBase64 : undefined,
        }) : undefined;
        let imageResult: ImageCheckResult | undefined;
        if (step.type === 'imageCheck') {
          const resolved = resolveVariableStep(step);
          imageResult = await checkImage({ config: resolved.imageCheck!,
            capture: async () => Buffer.from(await adbScreenshotBase64(deviceId, replayContext.getStore()?.signal), 'base64'),
            resolveRegion: () => imageCheckRegion(sessionId, resolved), wait,
            signal: replayContext.getStore()?.signal, saveImages: !variableContext.getStore()?.privacy.enabled });
          const config = resolved.imageCheck;
          const settings = config ? [
            IMAGE_CHECK_MODES[config.mode],
            config.mode === 'template' ? `预期匹配结果：${config.expectation === 'present' ? '匹配到模板' : '未匹配到模板'}` : '',
            ['template', 'state'].includes(config.mode) ? `匹配严格度 ${config.threshold * 100}%` : '',
            config.mode === 'state' ? `最小得分差 ${config.minScoreGap}` : '',
            ['black', 'color', 'change'].includes(config.mode) ? `RGB/亮度容差 ${config.tolerance}；像素占比 ${config.ratio}%` : '',
            config.mode === 'color' ? `目标色 ${config.color}` : '',
            config.mode === 'change' ? `预期：${config.expectation === 'present' ? '画面有变化' : '持续无明显变化'}` : '',
            config.mode !== 'state' ? `观察 ${config.durationMs}ms；间隔 ${config.intervalMs}ms；连续 ${config.consecutive} 帧` : '',
          ].filter(Boolean).join('；') : '缺少配置';
          replayContext.getStore()?.imageChecks.push({ ...imageResult, nodeId: step.id, nodeNumber: index + 1, nodeLabel: frameStep.label, scriptName: options.scriptName || '', settings });
          lines.push(`[节点 ${index + 1}] 图像判断：${imageResult.result === null ? '无法判定' : imageResult.result}，${imageResult.message}；${settings}；采样 ${imageResult.sampleCount} 帧，耗时 ${imageResult.durationMs}ms；指标 ${JSON.stringify(imageResult.metrics)}`);
          if (imageResult.result === null) throw new Error(imageResult.message);
          if (imageResult.timedOut) throw new ConditionTimeoutError(imageResult.message);
        }
        const matched = imageResult ? imageResult.result! : recognition ? recognition.result : await evaluateCondition(sessionId, deviceId, step);
        if (recognition) lines.push(`[节点 ${index + 1}] AI 识别：${recognition.result}，耗时 ${recognition.durationMs}ms，依据：${recognition.reason}`);
        const branchTargetId = matched ? step.flow?.yesTargetId : step.flow?.noTargetId;
        const next = traversal.branch(step, matched);
        const targetId = branchTargetId || (next === undefined ? '' : steps[next]?.id) || '';
        const branchLabel = flowBranchLabel(step, matched ? 'yes' : 'no');
        lines.push(`[节点 ${index + 1}] 判断：${branchLabel}${isNativeStateCondition(step) ? `（checked=${matched}）` : ''}${targetId ? `，进入 ${targetId}` : '，流程结束'}`);
        await captureReplayFrame(
          sessionId,
          frameStep,
          index + 1,
          options.scriptName || '',
          'after',
          `判断：${branchLabel}${recognition?.reason ? `；${recognition.reason}` : ''}`,
          recognition?.imageBase64,
        );
        index = next;
      } catch (error) {
        if (isReplayStopped(error)) {
          lines.push(`[节点 ${index + 1}] 已终止：${step.label}`);
          await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'stopped', '已终止');
          throw new ReplayStoppedError();
        }
        const invalidResultFallback = step.type === 'aiRecognition'
          ? resolveAiInvalidResultFallback(error, step.aiInvalidResultBranch)
          : null;
        if (invalidResultFallback !== null) {
          const status = `AI 未返回有效 true/false，按兜底配置进入 ${invalidResultFallback ? 'true' : 'false'} 分支`;
          lines.push(`[节点 ${index + 1}] ${status}；${errorDetail(error)}`);
          await captureReplayFrame(sessionId, frameStep, index + 1, options.scriptName || '', 'after', status);
          index = traversal.branch(step, invalidResultFallback);
          continue;
        }
        if (error instanceof ConditionTimeoutError && (step.timeoutBranch === 'yes' || step.timeoutBranch === 'no')) {
          const branch = step.timeoutBranch;
          const status = `判断超时，按配置进入${branch === 'yes' ? '左' : '右'}侧分支（${flowBranchLabel(step, branch)}）`;
          lines.push(`[节点 ${index + 1}] ${status}；${error.message}`);
          await captureReplayFrame(sessionId, frameStep, index + 1, options.scriptName || '', 'after', status);
          // 循环体必须经过 enter，才能正确记轮次及受最大次数保护。
          index = step.type === 'loop'
            ? branch === 'yes' ? traversal.enter(step).next : traversal.exit(step)
            : traversal.branch(step, branch === 'yes');
          continue;
        }
        lines.push(`[节点 ${index + 1}] 失败：${errorDetail(error)}`);
        await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'error', '失败');
        await appendStepDiagnostics(lines, deviceId, step);
        throw error;
      }
      continue;
    }

    try {
      let softFailed = false;
      if (step.type === 'breakLoop') {
        const exited = traversal.break(step);
        lines.push(`[循环 ${exited.loop.label}] 第 ${exited.iteration} 轮主动退出`);
        await captureReplayFrame(sessionId, frameStep, index + 1, options.scriptName || '', 'after', `已退出循环：${exited.loop.label}`);
        index = exited.next;
        continue;
      } else if (step.type === 'continueLoop') {
        const continued = traversal.continue(step);
        lines.push(`[循环 ${continued.loop.label}] 第 ${continued.iteration} 轮提前结束，进入下一轮判断`);
        await captureReplayFrame(sessionId, frameStep, index + 1, options.scriptName || '', 'after', `继续下一轮：${continued.loop.label}`);
        index = continued.next;
        continue;
      } else if (step.type === 'runScript') {
        await replayLinkedScript(sessionId, deviceId, step, lines, stack);
      } else {
        const result = await runStep(sessionId, deviceId, step, {
          onAiProgress: message => lines.push(`[节点 ${index + 1}] AI 持续观察：${message}`),
          onModelOutput: content => lines.push(`[节点 ${index + 1}] AI 识别模型输出：${content}`),
          nodeNumber: index + 1,
          scriptName: options.scriptName || '',
          frameStart: options.frameStart,
        });
        softFailed = appendRunStepResult(lines, index + 1, result);
      }
      lines.push(`[节点 ${index + 1}] 完成：${step.label}${softFailed ? '（存在软失败，已继续）' : ''}`);
      await captureReplayFrame(sessionId, frameStep, index + 1, options.scriptName || '', 'after', completedStepStatus(step, softFailed));
      processPendingVisualChecks(lines);
      index = nextIndexAfterStep(index, step);
    } catch (error) {
      if (isReplayStopped(error)) {
        lines.push(`[节点 ${index + 1}] 已终止：${step.label}`);
        await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'stopped', '已终止');
        throw new ReplayStoppedError();
      }
      const failureTarget = step.flow?.failureTargetId;
      if (failureTarget && idToIndex.has(failureTarget)) {
        lines.push(`[节点 ${index + 1}] 失败分支：${errorDetail(error)}`);
        await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'error', '进入失败分支');
        index = idToIndex.get(failureTarget);
        continue;
      }
      lines.push(`[节点 ${index + 1}] 失败：${errorDetail(error)}`);
      await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'error', '失败');
      lines.push(`执行路径：${visitedPath.join(' -> ')}`);
      await appendStepDiagnostics(lines, deviceId, step);
      throw error;
    }
  }
}

async function replayStepGroup(
  sessionId: string,
  deviceId: string,
  steps: AppiumRecordedStepRecord[],
  lines: string[],
  stack: string[],
  options: ReplayStepOptions = {},
) {
  if (!steps.length) return;
  if (hasFlowSteps(steps)) {
    await replayFlowSteps(sessionId, deviceId, steps, lines, stack, options);
  } else {
    await replayLinearSteps(sessionId, deviceId, steps, lines, stack, options);
  }
}

async function replayScriptSteps(
  sessionId: string,
  deviceId: string,
  steps: AppiumRecordedStepRecord[],
  lines: string[],
  stack: string[],
  options: ReplayStepOptions = {},
) {
  validateLoopSteps(steps);
  options = { ...options, frameStart: replayContext.getStore()?.frames.length || 0 };
  let trailingLinkIndex = steps.length;
  while (
    trailingLinkIndex > 0
    && steps[trailingLinkIndex - 1]?.type === 'runScript'
    && !steps[trailingLinkIndex - 1]?.flow?.parentConditionId
  ) {
    trailingLinkIndex -= 1;
  }

  const mainSteps = steps.slice(0, trailingLinkIndex);
  const trailingLinkedSteps = steps.slice(trailingLinkIndex);
  await replayStepGroup(sessionId, deviceId, mainSteps, lines, stack, options);

  for (const [offset, step] of trailingLinkedSteps.entries()) {
    if (replayContext.getStore()?.flowEnded) return;
    const nodeNumber = trailingLinkIndex + offset + 1;
    lines.push(`当前脚本步骤完成，开始执行：${step.label}`);
    lines.push(`[节点 ${nodeNumber}] 开始：${step.label}`);
    await captureReplayFrame(sessionId, step, nodeNumber, options.scriptName || '', 'before', '执行前');
    try {
      await replayLinkedScript(sessionId, deviceId, step, lines, stack);
      lines.push(`[节点 ${nodeNumber}] 完成：${step.label}`);
      await captureReplayFrame(sessionId, step, nodeNumber, options.scriptName || '', 'after', completedStepStatus(step, false));
    } catch (error) {
      if (isReplayStopped(error)) {
        lines.push(`[节点 ${nodeNumber}] 已终止：${step.label}`);
        await captureReplayFrame(sessionId, step, nodeNumber, options.scriptName || '', 'stopped', '已终止');
        throw new ReplayStoppedError();
      }
      lines.push(`[节点 ${nodeNumber}] 失败：${errorDetail(error)}`);
      await captureReplayFrame(sessionId, step, nodeNumber, options.scriptName || '', 'error', '失败');
      throw error;
    }
  }
}

export async function replayAppiumScript(
  script: AppiumRecordedScriptRecord,
  deviceId: string,
  onOutput?: (line: string) => void,
  signal?: AbortSignal,
  runOptions: { screenshotReport?: boolean; recordVideo?: boolean; reportSummaryEnabled?: boolean; reportSummaryPrompt?: string; parameters?: TestVariable[]; globalVariables?: TestVariable[]; linkedScripts?: AppiumRecordedScriptRecord[] } = {},
) {
  const targetDeviceId = deviceId || script.deviceId;
  if (!targetDeviceId) throw new Error('未检测到可用设备');
  if (!script.steps.length) throw new Error('脚本没有可回放步骤');

  const scope = new VariableScope(runOptions.globalVariables ?? getPresetVariables(), script.variables || []);
  const scripts = new Map((runOptions.linkedScripts ?? linkedScriptSnapshot(script)).map(item => [item.id, item]));
  for (const item of validateVariables(runOptions.parameters)) scope.set(item);
  // 提前登记子脚本敏感预设，避免进入子脚本前的原始日志或截图泄露。
  const visited = new Set<string>();
  const registerSecrets = (current: AppiumRecordedScriptRecord) => {
    if (visited.has(current.id)) return;
    visited.add(current.id);
    (current.variables || []).forEach(item => scope.track(item));
    for (const step of current.steps) {
      (step.parameters || []).forEach(item => scope.track(item));
      if (step.extractVariable) scope.track({ ...step.extractVariable, value: '' });
      if (step.type === 'runScript' && step.value) {
        const child = scripts.get(step.value);
        if (child) registerSecrets(child);
      }
    }
  };
  registerSecrets(script);

  const appiumConfig = loadConfig().appium;
  const configuredReportSummary = resolveReportSummary(appiumConfig.reportSummary);
  const reportSummary = resolveReportSummary({
    ...configuredReportSummary,
    enabled: runOptions.reportSummaryEnabled ?? configuredReportSummary.enabled,
    prompt: runOptions.reportSummaryPrompt?.trim() || configuredReportSummary.prompt,
  });
  const reportSummaryModel = appiumConfig.promptOptimizer?.model;
  const startedAt = new Date();
  const appVersion = await readAppVersion(targetDeviceId, script.appPackage).catch(() => '');
  const lines: string[] = [];
  const pushLine = lines.push.bind(lines);
  lines.push = (...items: string[]) => {
    items = items.map(item => timestampReplayLog(scope.redact(item)));
    const length = pushLine(...items);
    items.forEach((line) => onOutput?.(line));
    return length;
  };
  const context = {
    screenshotReport: (runOptions.screenshotReport ?? loadConfig().appium.screenshotReport) === true,
    visualCaptureNodes: new Set([script, ...scripts.values()].flatMap(item => item.steps.flatMap(step =>
      step.visualChange ? [step.id, step.visualChange.startStepId || '', step.visualChange.endStepId || ''] : []))),
    signal,
    appiumLog: (line) => { if (!scope.privacy.enabled) lines.push(line); },
    serverUrl: configuredAppiumServerUrl(),
    deviceId: targetDeviceId,
    scripts,
    frames: [] as AppiumReplayFrame[],
    historyEvents: [] as AppiumReplayFrame[],
    visualChecks: [] as AppiumReplayVisualCheck[],
    imageChecks: [] as Array<ImageCheckResult & { nodeId: string; nodeNumber: number; nodeLabel: string; scriptName: string; settings: string }>,
    visualStartOffsets: new Map<string, number>(),
    pendingVisualChecks: [] as PendingVisualChangeCheck[],
    softFailureCount: 0,
  };
  return variableContext.run(scope, () => replayContext.run(context, async () => {
    lines.push(context.screenshotReport ? '截图与 HTML 报告已开启：节点截图会增加回放耗时' : '截图与 HTML 报告已关闭：仅保留日志和运行历史，检测及手动截图节点仍按需截图');
    if (scope.privacy.enabled) lines.push('敏感变量保护已启用：不保存报告截图、截图节点文件或 Appium 原始日志');
    lines.push(
      `目标设备：${targetDeviceId}`,
      `App 包名：${script.appPackage}`,
      `录制步骤：${script.steps.length}`,
    );
    let sessionId = '';
    let sessionCreationStarted = false;
    let stopHeartbeat: (() => Promise<void>) | undefined;
    let success = false;
    let stopped = false;
    let recording: Awaited<ReturnType<typeof startReplayVideo>> | undefined;
    let video: ReplayVideo | undefined;
    let managedAppium: Awaited<ReturnType<typeof startManagedAppiumServer>> | null = null;
    try {
      validateLoopSteps(script.steps);
      lines.push('正在检测 Android SDK...');
      const androidSdk = ensureAndroidSdkAvailable();
      lines.push(`Android SDK 已就绪：${androidSdk.root}`);
      if (usesManagedAppiumServer()) {
        lines.push('正在启动本次回放的 Appium 服务...');
        lines.push('----- Appium 服务端原始日志开始 -----');
        managedAppium = await startManagedAppiumServer((line) => { if (!scope.privacy.enabled) lines.push(line); }, signal);
        context.serverUrl = managedAppium.serverUrl;
      }
      lines.push(`Appium 服务：${appiumServerUrl()}`);
      lines.push('正在创建 Appium session...');
      sessionCreationStarted = true;
      try {
        sessionId = await createSession(targetDeviceId);
      } catch (error) {
        throwIfReplayStopped(error);
        if (!isUiAutomationDisconnected(error)) throw error;
        lines.push('检测到 UiAutomation 连接冲突，正在清理残留进程并重试...');
        await resetUiAutomator2(targetDeviceId);
        sessionId = await createSession(targetDeviceId);
      }
      if (!managedAppium) {
        const heartbeatAbort = new AbortController();
        let heartbeatTask: Promise<unknown> | undefined;
        const timer = setInterval(() => {
          if (heartbeatTask || signal?.aborted) return;
          heartbeatTask = appiumRequest(`/session/${sessionId}/timeouts`, { signal: heartbeatAbort.signal }, { timeoutMs: 5000 })
            .catch(error => { if (!heartbeatAbort.signal.aborted && !signal?.aborted) lines.push(`Appium 保活失败：${errorDetail(error)}`); })
            .finally(() => { heartbeatTask = undefined; });
        }, 15000);
        timer.unref();
        stopHeartbeat = async () => { clearInterval(timer); heartbeatAbort.abort(); await heartbeatTask; };
      }
      lines.push(`Appium session 已创建：${sessionId}`);
      if (runOptions.recordVideo) {
        if (scope.privacy.enabled) throw new Error('本次运行包含敏感变量，为避免泄露已禁止录屏，请关闭录制回放视频');
        lines.push('正在启动后台录屏...');
        try {
          recording = await startReplayVideo(targetDeviceId, signal, message => lines.push(message));
          replayContext.getStore()!.selectVideoScript = recording.selectScript;
          await recording.selectScript(script.id, script.name);
        } catch (error) {
          if (!isReplayStopped(error)) {
            lines.push('[录屏提示] 录屏启动失败，尚未执行任何流程节点。请检查设备连接、其他录屏或投屏占用，以及报告目录的写入权限和磁盘空间；也可关闭“录制回放视频”后重新回放。详细原因见下方错误日志。');
          }
          throw error;
        }
        lines.push('后台录屏已启动（MP4 / H.264 / 最高15fps，无音频）');
      }
      if (hasFlowSteps(script.steps)) lines.push('按流程图路径回放...');
      await replayScriptSteps(sessionId, targetDeviceId, script.steps, lines, [script.id], {
        scriptName: script.name,
      });
      processPendingVisualChecks(lines);
      if (context.softFailureCount > 0) {
        lines.push(`回放完成，但存在 ${context.softFailureCount} 个视觉变化未达预期节点`);
        success = false;
      } else {
        lines.push('回放完成');
        success = true;
      }
    } catch (error) {
      stopped = isReplayStopped(error);
      const detail = errorDetail(error);
      if (stopped) {
        lines.push('回放已终止：用户手动终止');
      } else {
        if (detail.includes('Appium Settings app is not running')) {
          await appendSettingsDiagnostics(lines, targetDeviceId);
        }
        if (detail.includes('Neither ANDROID_HOME nor ANDROID_SDK_ROOT')) {
          appendAndroidSdkDiagnostics(lines);
        }
        lines.push(`回放终止：${detail}`);
      }
    } finally {
      if (recording) {
        try {
          video = await recording.stop();
          if (scope.privacy.enabled) {
            for (const segment of video.segments || [video]) {
              await import('node:fs/promises').then(fs => fs.rm(segment.filePath, { force: true }));
            }
            video = undefined;
            lines.push('敏感变量保护：已删除回放视频');
          } else {
            for (const [index, segment] of (video.segments || [video]).entries()) {
              lines.push(`回放视频 ${index + 1}（${segment.scriptName || script.name}）已保存：${segment.filePath}`);
            }
            if (video.warning) {
              lines.push(`录屏警告：${video.warning}`);
              lines.push('[录屏提示] 本次录像可能不完整，请结合节点日志和截图确认执行结果；需要完整录像时，请检查设备连接和录屏占用后重新回放。');
            }
          }
        } catch (error) {
          lines.push(`回放视频保存失败：${errorDetail(error)}`);
          lines.push('[录屏提示] 本次录像未能完整保存。请检查报告目录的写入权限、磁盘空间及设备连接；录像保存失败不等同于流程节点失败，请以节点执行日志为准。');
        }
      }
      await stopHeartbeat?.();
      let managedAppiumStopped = false;
      if (signal?.aborted && managedAppium) {
        await managedAppium.stop();
        managedAppiumStopped = true;
      } else if (sessionId) {
        await appiumRequest(
          `/session/${sessionId}`,
          { method: 'DELETE' },
          { ignoreAbort: true, timeoutMs: 2000 },
        ).catch(error => { lines.push(`Appium 会话清理失败：${errorDetail(error)}${managedAppium ? '' : '；外部服务将在命令空闲 60 秒后回收会话'}`); });
      }
      if (managedAppium) {
        if (!managedAppiumStopped) await managedAppium.stop();
        if (sessionCreationStarted) {
          try {
            await stopManagedUiAutomator(targetDeviceId, getAdbCommand());
          } catch (error) {
            lines.push(`设备端 UiAutomator2 清理失败，可能影响组件树刷新：${errorDetail(error)}`);
          }
        }
        lines.push('----- Appium 服务端原始日志结束 -----');
      }
      if (runOptions.recordVideo) {
        if (video) {
          for (const [index, segment] of (video.segments || [video]).entries()) {
            lines.push(`录屏位置 ${index + 1}（${segment.scriptName || script.name}）：${segment.filePath}`);
          }
        } else {
          lines.push(scope.privacy.enabled
            ? '录屏位置：无（敏感变量保护，本次不保留录像）'
            : '录屏位置：无（未生成可用视频，请查看上方录屏提示）');
        }
      }
    }

    if (signal?.aborted && !stopped) {
      stopped = true;
      success = false;
      lines.push('回放已终止：用户手动终止');
    }

    const completedAt = new Date();
    const safeFrames = scope.privacy.enabled || !context.screenshotReport ? [] : scope.scrub(context.frames);
    const safeChecks = scope.scrub(context.visualChecks.map(check => scope.privacy.enabled
      ? { ...check, baselineBase64: '', comparisonBase64: '', diffBase64: '' } : check));
    let reportPath = '';
    let reportId = '';
    let logPath = '';
    let htmlReportPath = '';
    try {
      const report = await createAppiumReplayReport({
        reportSummary,
        reportSummaryModel,
        linkedScripts: scope.scrub([...scripts.values()].filter(item => item.id !== script.id)),
        redact: text => scope.redact(text),
        onSummaryStatus: status => { lines.push(status); },
        screenshotReport: context.screenshotReport,
        script: scope.scrub(script),
        deviceId: targetDeviceId,
        success,
        stopped,
        output: scope.redact(lines.join('\n')),
        video,
        startedAt,
        completedAt,
        frames: safeFrames,
        visualChecks: safeChecks,
        imageChecks: scope.scrub(context.imageChecks.map(check => scope.privacy.enabled ? { ...check, images: [] } : check)),
      });
      reportPath = report.filePath;
      reportId = report.id;
      logPath = report.logPath;
      htmlReportPath = report.htmlReportPath;
      lines.push(`回放报告已生成：${reportPath}`);
      if (report.htmlReportPath) lines.push(`截图回放已生成：${report.htmlReportPath}`);
      lines.push(`回放日志已生成：${logPath}`);
    } catch (error) {
      lines.push(`回放报告和日志生成失败：${errorDetail(error)}`);
    }
    return {
      success,
      stopped,
      output: scope.redact(lines.join('\n')),
      reportPath,
      reportId,
      logPath,
      htmlReportPath,
      videoPath: video?.filePath,
      softFailureCount: context.softFailureCount,
      history: {
        scriptId: script.id, scriptName: script.name, appPackage: script.appPackage,
        video,
        appVersion, deviceId: targetDeviceId, startedAt: startedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        status: stopped ? 'stopped' as const : success ? 'passed' as const : 'failed' as const,
        output: scope.redact(lines.join('\n')),
        ...scope.scrub(captureHistoryFrames(safeFrames, safeChecks, context.historyEvents)),
      },
    };
  }));
}

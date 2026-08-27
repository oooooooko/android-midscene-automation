import { execFile } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAppiumRecordedScript, type AppiumRecordedScriptRecord, type AppiumRecordedStepRecord } from './repository';
import { appDataPath } from '../paths';
import { ensureAndroidSdkAvailable, getAdbCommand } from '../android-sdk';
import { createAppiumReplayReport, type AppiumReplayFrame } from './report';
import { startManagedAppiumServer, usesManagedAppiumServer } from './managed-appium';

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

const replayContext = new AsyncLocalStorage<{
  signal?: AbortSignal;
  appiumLog: (line: string) => void;
  serverUrl: string;
  frames: AppiumReplayFrame[];
}>();

const appiumServerUrl = () => replayContext.getStore()?.serverUrl || configuredAppiumServerUrl();

function isReplayStopped(error?: unknown) {
  return error instanceof ReplayStoppedError || replayContext.getStore()?.signal?.aborted === true;
}

function throwIfReplayStopped(error?: unknown) {
  if (isReplayStopped(error)) throw new ReplayStoppedError();
}

function errorDetail(error: unknown) {
  if (!(error instanceof Error)) return String(error || '未知错误');
  const cause = error.cause;
  if (cause instanceof Error && cause.message && cause.message !== error.message) {
    return `${error.message}：${cause.message}`;
  }
  return error.message;
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
  return new Promise<void>((resolve, reject) => {
    execFile(getAdbCommand(), ['-s', deviceId, 'shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))], (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve();
    });
  });
}

export function launchAppOnDevice(deviceId: string, packageName: string) {
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
    ], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = `${stdout || ''}\n${stderr || ''}`.trim();
      if (error || /no activities found|monkey aborted/i.test(output)) {
        reject(new Error(output || error?.message || `ADB 启动 ${packageName} 失败`));
        return;
      }
      resolve();
    });
  });
}

export function clearAppDataOnDevice(deviceId: string, packageName: string) {
  if (!packageName) return Promise.reject(new Error('清理 App 缓存缺少包名'));
  return new Promise<void>((resolve, reject) => {
    execFile(getAdbCommand(), [
      '-s',
      deviceId,
      'shell',
      'pm',
      'clear',
      packageName,
    ], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
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
    ], (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve();
    });
  });
}

function adbText(deviceId: string, args: string[]) {
  return new Promise<string>((resolve) => {
    execFile(getAdbCommand(), ['-s', deviceId, ...args], { maxBuffer: 4 * 1024 * 1024 }, (_error, stdout, stderr) => {
      resolve((stdout || stderr || '').trim());
    });
  });
}

async function getCurrentActivity(deviceId: string) {
  const output = await adbText(deviceId, ['shell', 'dumpsys', 'activity', 'activities']);
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
  const timeoutMs = step.timeoutMs || 10000;
  let currentActivity = '';
  while (Date.now() - startedAt <= timeoutMs) {
    throwIfReplayStopped();
    currentActivity = await getCurrentActivity(deviceId);
    if (currentActivity === expectedActivity) return;
    await wait(500);
  }
  throw new Error(`${step.label} 等待超时，当前 Activity：${currentActivity || '-'}`);
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
  try {
    response = await fetch(requestUrl, {
      ...init,
      signal: options?.ignoreAbort
        ? (options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined)
        : context?.signal || init?.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  } catch (error) {
    if (isReplayStopped(error) && !options?.ignoreAbort) {
      context?.appiumLog(`[Appium] 取消：${method} ${path}`);
      throw new ReplayStoppedError();
    }
    context?.appiumLog(`[Appium] 异常：${method} ${path}（${errorDetail(error)}）`);
    throw new Error(`无法连接 Appium 服务 ${requestUrl}，${errorDetail(error)}`);
  }

  const responseText = await response.text();
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
    throw new Error(`Appium ${method} ${path} 失败（HTTP ${response.status}）：\n${detail || '未返回错误详情'}`);
  }
  return payload;
}

function replayFrameSelector(step: AppiumRecordedStepRecord) {
  const selector = step.selector;
  if (!selector) return '-';
  if (selector.strategy === 'bounds') return `bounds (${selector.centerX ?? '-'}, ${selector.centerY ?? '-'})`;
  return `${selector.strategy} ${selector.value || ''}`.trim();
}

async function captureReplayFrame(
  sessionId: string,
  step: AppiumRecordedStepRecord,
  nodeNumber: number,
  scriptName: string,
  phase: AppiumReplayFrame['phase'],
  status: string,
) {
  const context = replayContext.getStore();
  if (!context || !sessionId) return;
  const appendFrame = (imageBase64: string) => {
    context.frames.push({
      sequence: context.frames.length + 1,
      scriptName,
      nodeId: step.id,
      nodeNumber,
      nodeLabel: step.label,
      nodeType: step.type,
      note: step.note || '',
      selector: replayFrameSelector(step),
      phase,
      status,
      capturedAt: new Date().toISOString(),
      imageBase64,
    });
  };

  if (phase === 'stopped' && context.signal?.aborted) {
    const previousFrame = context.frames.at(-1);
    if (previousFrame) appendFrame(previousFrame.imageBase64);
    return;
  }

  try {
    const payload = await appiumRequest<AppiumValueResponse<string>>(
      `/session/${sessionId}/screenshot`,
      undefined,
      { ignoreAbort: true, timeoutMs: 5000 },
    );
    const imageBase64 = typeof payload.value === 'string' ? payload.value : '';
    if (!imageBase64) throw new Error('Appium 未返回截图内容');
    appendFrame(imageBase64);
  } catch (error) {
    context.appiumLog(`[节点 ${nodeNumber}] 截图失败：${errorDetail(error)}`);
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

async function findElement(sessionId: string, step: AppiumRecordedStepRecord) {
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

  for (const selector of step.selectorChain || []) {
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

async function tapFallback(deviceId: string, step: AppiumRecordedStepRecord) {
  if (step.fallback?.strategy !== 'bounds' || !Number.isFinite(step.fallback.centerX) || !Number.isFinite(step.fallback.centerY)) {
    throw new Error(`${step.label} 未找到元素，且没有可用坐标兜底`);
  }
  await adbTap(deviceId, Number(step.fallback.centerX), Number(step.fallback.centerY));
}

async function waitForElement(sessionId: string, step: AppiumRecordedStepRecord) {
  const startedAt = Date.now();
  const timeoutMs = step.timeoutMs || 10000;
  let lastError: unknown;
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      await findElement(sessionId, step);
      return;
    } catch (error) {
      throwIfReplayStopped(error);
      lastError = error;
      await wait(500);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${step.label} 等待超时`);
}

async function findOptionalElement(sessionId: string, step: AppiumRecordedStepRecord) {
  const startedAt = Date.now();
  const timeoutMs = step.timeoutMs ?? 2000;
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      return await findElement(sessionId, step);
    } catch (error) {
      throwIfReplayStopped(error);
      await wait(250);
    }
  }
  return '';
}

async function waitForElementGone(sessionId: string, step: AppiumRecordedStepRecord) {
  const startedAt = Date.now();
  const timeoutMs = step.timeoutMs || 10000;
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      await findElement(sessionId, step);
    } catch (error) {
      throwIfReplayStopped(error);
      return;
    }
    await wait(500);
  }
  throw new Error(`${step.label} 等待消失超时`);
}

async function saveScreenshot(sessionId: string) {
  const payload = await appiumRequest<AppiumValueResponse<string>>(`/session/${sessionId}/screenshot`);
  if (!payload.value) throw new Error('Appium 未返回截图数据');
  const dir = appDataPath('.midscene-app', 'screenshots');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `appium-${Date.now()}.png`);
  await writeFile(file, Buffer.from(payload.value, 'base64'));
}

async function runStep(sessionId: string, deviceId: string, step: AppiumRecordedStepRecord) {
  throwIfReplayStopped();
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
    if (await isAppInForeground(deviceId, packageName).catch(() => false)) {
      return `APP 已在前台，跳过启动 ${packageName}`;
    }
    await launchAppOnDevice(deviceId, packageName);
    return `ADB 已启动 ${packageName}`;
  }

  if (step.type === 'clearAppData') {
    const packageName = step.value || '';
    await clearAppDataOnDevice(deviceId, packageName);
    return `ADB 已清除 ${packageName} 的应用数据与缓存`;
  }

  if (step.type === 'screenshot') {
    await saveScreenshot(sessionId);
    return;
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
    if (step.fallback?.strategy !== 'bounds' || !Number.isFinite(step.fallback.centerX) || !Number.isFinite(step.fallback.centerY)) {
      throw new Error(`${step.label} 缺少长按坐标`);
    }
    const x = Number(step.fallback.centerX);
    const y = Number(step.fallback.centerY);
    await adbSwipe(deviceId, { startX: x, startY: y, endX: x, endY: y, duration: step.timeoutMs || 800 });
    return;
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

async function evaluateCondition(sessionId: string, deviceId: string, step: AppiumRecordedStepRecord) {
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
      const elementId = await findElement(sessionId, step);
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
    return false;
  }
}

function hasFlowSteps(steps: AppiumRecordedStepRecord[]) {
  return steps.some((step) => (
    step.flow?.nodeKind === 'condition'
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
  skipAppInitialization?: boolean;
  scriptName?: string;
};

function shouldSkipLinkedScriptInitStep(options: ReplayStepOptions, step: AppiumRecordedStepRecord) {
  return Boolean(options.skipAppInitialization && (step.type === 'launchApp' || step.type === 'clearAppData'));
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
  const linkedScript = getAppiumRecordedScript(scriptId);
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
          timeoutMs: 10000,
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

  lines.push(`连接脚本开始：${linkedScript.name}`);
  const nextStack = [...stack, linkedScript.id];
  await replayScriptSteps(sessionId, deviceId, linkedScript.steps, lines, nextStack, {
    skipAppInitialization: true,
    scriptName: linkedScript.name,
  });
  lines.push(`连接脚本完成：${linkedScript.name}`);
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
    throwIfReplayStopped();
    if (shouldSkipLinkedScriptInitStep(options, step)) {
      lines.push(`[节点 ${index + 1}] 跳过：${step.label}（${linkedScriptInitSkipReason(step)}）`);
      continue;
    }
    lines.push(`[节点 ${index + 1}] 开始：${step.label}`);
    await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'before', '执行前');
    try {
      if (step.type === 'runScript') {
        await replayLinkedScript(sessionId, deviceId, step, lines, stack);
      } else {
        const result = await runStep(sessionId, deviceId, step);
        if (result) lines.push(`[节点 ${index + 1}] 结果：${result}`);
      }
      lines.push(`[节点 ${index + 1}] 完成：${step.label}`);
      await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'after', '成功');
    } catch (error) {
      if (isReplayStopped(error)) {
        lines.push(`[节点 ${index + 1}] 已终止：${step.label}`);
        await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'stopped', '已终止');
        throw new ReplayStoppedError();
      }
      if (step.optional) {
        lines.push(`[节点 ${index + 1}] 跳过：${errorDetail(error)}`);
        await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'error', '已跳过');
        continue;
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
  const conditionContinuationIndex = (conditionId: string) => {
    const conditionIndex = idToIndex.get(conditionId);
    if (conditionIndex === undefined) return undefined;
    const explicitTargetId = steps[conditionIndex]?.flow?.successTargetId;
    return explicitTargetId ? idToIndex.get(explicitTargetId) : undefined;
  };
  const nextIndexAfterStep = (currentIndex: number, step: AppiumRecordedStepRecord) => {
    const explicitTargetId = step.flow?.successTargetId;
    if (explicitTargetId) return idToIndex.get(explicitTargetId);
    if (!step.flow?.parentConditionId || !step.flow.parentBranch) return currentIndex + 1;
    const nextStep = steps[currentIndex + 1];
    const staysInBranch = nextStep?.flow?.parentConditionId === step.flow.parentConditionId
      && nextStep.flow.parentBranch === step.flow.parentBranch;
    return staysInBranch
      ? currentIndex + 1
      : conditionContinuationIndex(step.flow.parentConditionId);
  };
  const visitedPath: string[] = [];
  let index: number | undefined = 0;
  let guard = 0;
  const maxVisits = Math.max(steps.length * 4, 20);

  while (typeof index === 'number' && index >= 0 && index < steps.length) {
    throwIfReplayStopped();
    guard += 1;
    if (guard > maxVisits) throw new Error('流程图可能存在循环，已终止回放');

    const step = steps[index];
    if (shouldSkipLinkedScriptInitStep(options, step)) {
      lines.push(`[节点 ${index + 1}] 跳过：${step.label}（${linkedScriptInitSkipReason(step)}）`);
      index = nextIndexAfterStep(index, step);
      continue;
    }
    visitedPath.push(step.label);
    const nodeKind = step.flow?.nodeKind || (step.type === 'assertExists' || step.type === 'assertText' ? 'assertion' : 'action');
    lines.push(`[节点 ${index + 1}] 开始：${step.label}`);
    await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'before', '执行前');

    if (nodeKind === 'condition') {
      try {
        const matched = await evaluateCondition(sessionId, deviceId, step);
        const branchTargetId = matched ? step.flow?.yesTargetId : step.flow?.noTargetId;
        const targetId = branchTargetId || step.flow?.successTargetId || '';
        lines.push(`[节点 ${index + 1}] 判断：${matched ? '是' : '否'}${targetId ? `，进入 ${targetId}` : '，流程结束'}`);
        await captureReplayFrame(
          sessionId,
          step,
          index + 1,
          options.scriptName || '',
          'after',
          `判断：${matched ? '是' : '否'}`,
        );
        index = targetId ? idToIndex.get(targetId) : undefined;
      } catch (error) {
        if (isReplayStopped(error)) {
          lines.push(`[节点 ${index + 1}] 已终止：${step.label}`);
          await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'stopped', '已终止');
          throw new ReplayStoppedError();
        }
        throw error;
      }
      continue;
    }

    try {
      if (step.type === 'runScript') {
        await replayLinkedScript(sessionId, deviceId, step, lines, stack);
      } else {
        const result = await runStep(sessionId, deviceId, step);
        if (result) lines.push(`[节点 ${index + 1}] 结果：${result}`);
      }
      lines.push(`[节点 ${index + 1}] 完成：${step.label}`);
      await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'after', '成功');
      index = nextIndexAfterStep(index, step);
    } catch (error) {
      if (isReplayStopped(error)) {
        lines.push(`[节点 ${index + 1}] 已终止：${step.label}`);
        await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'stopped', '已终止');
        throw new ReplayStoppedError();
      }
      if (step.optional) {
        lines.push(`[节点 ${index + 1}] 跳过：${errorDetail(error)}`);
        await captureReplayFrame(sessionId, step, index + 1, options.scriptName || '', 'error', '已跳过');
        index = nextIndexAfterStep(index, step);
        continue;
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
    const nodeNumber = trailingLinkIndex + offset + 1;
    lines.push(`当前脚本步骤完成，开始执行：${step.label}`);
    lines.push(`[节点 ${nodeNumber}] 开始：${step.label}`);
    await captureReplayFrame(sessionId, step, nodeNumber, options.scriptName || '', 'before', '执行前');
    try {
      await replayLinkedScript(sessionId, deviceId, step, lines, stack);
      lines.push(`[节点 ${nodeNumber}] 完成：${step.label}`);
      await captureReplayFrame(sessionId, step, nodeNumber, options.scriptName || '', 'after', '成功');
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
) {
  const targetDeviceId = deviceId || script.deviceId;
  if (!targetDeviceId) throw new Error('未检测到可用设备');
  if (!script.steps.length) throw new Error('脚本没有可回放步骤');

  const startedAt = new Date();
  const lines: string[] = [];
  const pushLine = lines.push.bind(lines);
  lines.push = (...items: string[]) => {
    const length = pushLine(...items);
    items.forEach((line) => onOutput?.(line));
    return length;
  };
  const context = {
    signal,
    appiumLog: (line) => lines.push(line),
    serverUrl: configuredAppiumServerUrl(),
    frames: [] as AppiumReplayFrame[],
  };
  return replayContext.run(context, async () => {
    lines.push(
      `目标设备：${targetDeviceId}`,
      `App 包名：${script.appPackage}`,
      `录制步骤：${script.steps.length}`,
    );
    let sessionId = '';
    let success = false;
    let stopped = false;
    let managedAppium: Awaited<ReturnType<typeof startManagedAppiumServer>> | null = null;
    try {
      lines.push('正在检测 Android SDK...');
      const androidSdk = ensureAndroidSdkAvailable();
      lines.push(`Android SDK 已就绪：${androidSdk.root}`);
      if (usesManagedAppiumServer()) {
        lines.push('正在启动本次回放的 Appium 服务...');
        lines.push('----- Appium 服务端原始日志开始 -----');
        managedAppium = await startManagedAppiumServer((line) => lines.push(line), signal);
        context.serverUrl = managedAppium.serverUrl;
      }
      lines.push(`Appium 服务：${appiumServerUrl()}`);
      lines.push('正在创建 Appium session...');
      try {
        sessionId = await createSession(targetDeviceId);
      } catch (error) {
        throwIfReplayStopped(error);
        if (!isUiAutomationDisconnected(error)) throw error;
        lines.push('检测到 UiAutomation 连接冲突，正在清理残留进程并重试...');
        await resetUiAutomator2(targetDeviceId);
        sessionId = await createSession(targetDeviceId);
      }
      lines.push(`Appium session 已创建：${sessionId}`);
      if (hasFlowSteps(script.steps)) lines.push('按流程图路径回放...');
      await replayScriptSteps(sessionId, targetDeviceId, script.steps, lines, [script.id], {
        scriptName: script.name,
      });
      lines.push('回放完成');
      success = true;
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
      let managedAppiumStopped = false;
      if (signal?.aborted && managedAppium) {
        await managedAppium.stop();
        managedAppiumStopped = true;
      } else if (sessionId) {
        await appiumRequest(
          `/session/${sessionId}`,
          { method: 'DELETE' },
          { ignoreAbort: true, timeoutMs: 2000 },
        ).catch(() => undefined);
      }
      if (managedAppium) {
        if (!managedAppiumStopped) await managedAppium.stop();
        lines.push('----- Appium 服务端原始日志结束 -----');
      }
    }

    if (signal?.aborted && !stopped) {
      stopped = true;
      success = false;
      lines.push('回放已终止：用户手动终止');
    }

    const completedAt = new Date();
    let reportPath = '';
    let reportId = '';
    let logPath = '';
    let htmlReportPath = '';
    try {
      const report = await createAppiumReplayReport({
        script,
        deviceId: targetDeviceId,
        success,
        stopped,
        output: lines.join('\n'),
        startedAt,
        completedAt,
        frames: context.frames,
      });
      reportPath = report.filePath;
      reportId = report.id;
      logPath = report.logPath;
      htmlReportPath = report.htmlReportPath;
      lines.push(`回放报告已生成：${reportPath}`);
      lines.push(`截图回放已生成：${report.htmlReportPath}`);
      lines.push(`回放日志已生成：${logPath}`);
    } catch (error) {
      lines.push(`回放报告和日志生成失败：${errorDetail(error)}`);
    }
    return {
      success,
      stopped,
      output: lines.join('\n'),
      reportPath,
      reportId,
      logPath,
      htmlReportPath,
    };
  });
}

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { appDataPath, appPath } from './paths';
import {
  getScriptRecord,
  removeScriptRecord,
  updateScriptRecordCode,
  upsertScriptRecord,
  type ScriptStepRecord,
} from './script-db';

const STEP_EVENT_PREFIX = '__MIDSCENE_STEP_EVENT__';
const SCRIPT_TIMEOUT_MS = Number(process.env.MIDSCENE_SCRIPT_TIMEOUT_MS || 600_000);
const require = createRequire(import.meta.url);
const tsxBin = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');

function injectMidsceneEnv(code: string) {
  const configModuleUrl = pathToFileURL(appPath('server', 'config.ts')).href;
  const withImport = `import { applyMidsceneEnv } from ${JSON.stringify(configModuleUrl)};\n${code}`;
  return withImport.replace('async function main() {', 'async function main() {\n  applyMidsceneEnv();');
}

function toScriptFileName(scriptName: string) {
  const normalized = scriptName.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'generated-script';
  return `${normalized}.ts`;
}

export function checkGeneratedScriptExists(input: { scriptName: string }) {
  const outputDir = appDataPath('scripts-output');
  const filePath = path.join(outputDir, toScriptFileName(input.scriptName));
  return {
    exists: fs.existsSync(filePath),
    filePath,
  };
}

export function saveGeneratedScript(input: {
  code: string;
  scriptName: string;
  promptTitle?: string;
  sourcePrompt?: string;
  steps?: ScriptStepRecord[];
}) {
  validateGeneratedScriptCode(input.code);

  const outputDir = appDataPath('scripts-output');
  fs.mkdirSync(outputDir, { recursive: true });

  const filePath = path.join(outputDir, toScriptFileName(input.scriptName));
  fs.writeFileSync(filePath, input.code, 'utf8');
  const record = upsertScriptRecord({
    name: input.scriptName,
    promptTitle: input.promptTitle || input.scriptName,
    sourcePrompt: input.sourcePrompt || '',
    code: input.code,
    filePath,
    steps: input.steps || [],
  });

  return {
    success: true,
    filePath,
    script: record,
  };
}

export function validateGeneratedScriptCode(code: string) {
  if (!code.trim()) {
    throw new Error('代码不能为空');
  }

  const result = ts.transpileModule(code, {
    fileName: 'script.ts',
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
      skipLibCheck: true,
    },
  });
  const diagnostics = (result.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);

  if (diagnostics.length) {
    const message = diagnostics
      .slice(0, 3)
      .map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n'))
      .join('\n');
    throw new Error(`代码格式错误：${message}`);
  }
}

export function updateGeneratedScriptCode(input: { id: string; code: string }) {
  validateGeneratedScriptCode(input.code);

  const record = getScriptRecord(input.id);
  if (!record) {
    throw new Error('脚本不存在或已被删除');
  }

  const filePath = path.resolve(record.filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, input.code, 'utf8');

  const script = updateScriptRecordCode({
    id: input.id,
    code: input.code,
    filePath,
  });

  if (!script) {
    throw new Error('脚本保存失败');
  }

  return {
    success: true,
    script,
  };
}

export function deleteGeneratedScript(input: { id: string }) {
  const record = removeScriptRecord(input.id);
  if (!record) {
    return {
      success: false,
      deletedFile: false,
    };
  }

  const outputDir = appDataPath('scripts-output');
  const filePath = path.resolve(record.filePath);
  const canDeleteFile = filePath.startsWith(`${outputDir}${path.sep}`) && fs.existsSync(filePath);
  if (canDeleteFile) {
    fs.unlinkSync(filePath);
  }

  return {
    success: true,
    deletedFile: canDeleteFile,
    script: record,
  };
}

function safeVar(value: string | undefined, fallback: string) {
  const normalized = (value || '').trim().replace(/[^a-zA-Z0-9_$]+/g, '_').replace(/^(\d)/, '_$1');
  return normalized || fallback;
}

function escapeTemplate(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function serializeStep(step: ScriptStepRecord, index: number) {
  return JSON.stringify({
    index,
    id: step.id || String(index),
    title: step.label || `步骤 ${index + 1}`,
    method: step.type,
    prompt: step.prompt || step.value || '',
  });
}

function getRepeatCount(step: ScriptStepRecord) {
  const repeat = Number(step.repeat || 1);
  if (!Number.isFinite(repeat)) return 1;
  return Math.max(1, Math.min(10, Math.floor(repeat)));
}

function normalizeRuntimeSteps(steps: ScriptStepRecord[]) {
  const normalized = steps.map((step) => {
    const label = step.label || '';
    const prompt = step.prompt || '';
    const stepText = `${label} ${prompt}`;
    const isStartupPopupHandling = /(处理|关闭|循环处理).*(启动)?弹窗|启动阶段.*弹窗/.test(label);
    const isSoftKeyboardLoginHint = /(软键盘|键盘遮挡)/.test(prompt) && /(登录按钮|提交登录|提交当前已填写)/.test(prompt);
    const isConditionalNoopAction =
      !isSoftKeyboardLoginHint &&
      /(如果|若|如有|如果当前|如果.*未勾选|已勾选|不存在.*跳过|则跳过|保持当前|否则)/.test(prompt);
    const isConditionalNoopTap =
      step.type === 'tap' &&
      isConditionalNoopAction;
    const isLoginOneShotAction =
      (step.type === 'act' || step.type === 'tap') &&
      !isStartupPopupHandling &&
      !isConditionalNoopAction &&
      (/(登录按钮|提交登录|登录提交|账号密码登录入口|登录协议|协议勾选|勾选.*协议|复选框|同意协议弹窗|协议确认弹窗)/.test(label) ||
        /^(点击登录页中的登录按钮|登录页中的登录按钮|登录页底部.*勾选框|.*协议.*确认.*按钮|.*同意.*按钮)/.test(prompt));
    const isPopupHandlingAct =
      (step.type === 'act' || isConditionalNoopTap) &&
      (isStartupPopupHandling ||
        (!/(登录按钮|提交登录|登录提交|登录协议|协议勾选|勾选.*协议|复选框)/.test(stepText) &&
          /弹窗|权限|协议|隐私|广告|活动|更新|通知|声明与条款/.test(stepText)));

    return {
      ...step,
      type: step.type === 'act' && isLoginOneShotAction ? 'tap' : isConditionalNoopTap ? 'act' : step.type,
      repeat: isLoginOneShotAction ? 1 : step.repeat || (isPopupHandlingAct ? 2 : 1),
    };
  });

  return normalized.flatMap((step, index) => {
    const label = step.label || '';
    const followingSteps = normalized.slice(index + 1, index + 3);
    const shouldInsertResubmit =
      /(确认协议弹窗|同意协议弹窗|协议确认弹窗)/.test(label) &&
      followingSteps.some((item) => item.type === 'waitFor' && /(首页|主界面|登录成功)/.test(`${item.label || ''} ${item.prompt || ''}`)) &&
      !followingSteps.some((item) => /(再次提交登录|重新提交登录|再次点击登录)/.test(item.label || ''));

    if (!shouldInsertResubmit) {
      return [step];
    }

    return [
      step,
      {
        id: `${step.id || index}-resubmit-login`,
        type: 'act',
        label: '确认协议后再次提交登录',
        prompt:
          '如果当前仍停留在登录页且账号密码已填写、登录协议已同意，点击登录按钮再次提交；如果已经进入首页或正在加载首页，保持当前状态。不要修改账号、密码或其他输入框。',
        repeat: 1,
        enabled: step.enabled,
      },
    ];
  });
}

function withRepeat(step: ScriptStepRecord, body: string) {
  const repeat = getRepeatCount(step);
  if (repeat <= 1) return body;

  const inner = body
    .split('\n')
    .map((line) => `      ${line.replace(/^    /, '')}`)
    .join('\n');

  return `    for (let attempt = 1; attempt <= ${repeat}; attempt += 1) {
      console.log(${JSON.stringify(`执行${step.label || step.type}`)}, attempt);
${inner}
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }`;
}

// 对动作期间的短暂 UI 进行多帧采样；finally 确保动作失败时也会释放观察器。
function withObservation(step: ScriptStepRecord, index: number, body: string) {
  const assertion = step.observePrompt?.trim();
  if (!assertion) return body;

  const observerVar = `observer${index + 1}`;
  const nestedBody = body
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

  return `    const ${observerVar} = await agent.startObserving({ intervalMs: 500, maxFrames: 20 });
    try {
${nestedBody}
    } finally {
      await ${observerVar}.stop();
    }
    await ${observerVar}.aiAssert(\`${escapeTemplate(assertion)}\`);`;
}

function getBooleanFailureRule(step: ScriptStepRecord, outputVar: string) {
  const signalText = `${outputVar} ${step.label || ''}`;
  const shouldFailWhenTrue =
    /has.*(modal|popup|dialog|blocking)|hasBlocking|blockingModal/i.test(signalText) ||
    (step.label || '').includes('确认无干扰弹窗') ||
    (step.label || '').includes('遮挡弹窗');
  const shouldFailWhenFalse =
    /is.*(ready|loaded|success)|isLoginReady|loginReady/i.test(signalText) ||
    (step.label || '').includes('验证登录页就绪') ||
    (step.label || '').includes('登录页就绪');
  return { shouldFailWhenTrue, shouldFailWhenFalse };
}

function buildAndroidStepCall(step: ScriptStepRecord, index: number) {
  const prompt = escapeTemplate(step.prompt || '');
  const value = step.value || '';
  const outputVar = safeVar(step.outputVar, `step${index + 1}Result`);

  switch (step.type) {
    case 'comment':
      return `    console.log(${JSON.stringify(step.prompt || step.label || '')});`;
    case 'waitFor':
      return `    await agent.aiWaitFor(\`${prompt}\`);`;
    case 'act':
      return withObservation(step, index, withRepeat(step, `    await agent.aiAct(\`${prompt}\`);`));
    case 'tap':
      return withObservation(step, index, withRepeat(step, `    await agent.aiTap(\`${prompt}\`);`));
    case 'input':
      return withObservation(
        step,
        index,
        `    await agent.aiInput(\`${prompt}\`, { value: ${JSON.stringify(value)} });`,
      );
    case 'query':
      return `    const ${outputVar} = await agent.aiQuery(${JSON.stringify(step.prompt || '')});\n    console.log(${JSON.stringify(step.label || outputVar)}, ${outputVar});`;
    case 'boolean':
      {
        const { shouldFailWhenTrue, shouldFailWhenFalse } = getBooleanFailureRule(step, outputVar);
        return `    const ${outputVar} = await agent.aiBoolean(\`${prompt}\`);\n    console.log(${JSON.stringify(step.label || outputVar)}, ${outputVar});${
          shouldFailWhenTrue
            ? `\n    if (${outputVar}) {\n      throw new Error(${JSON.stringify(`${step.label || outputVar} 未通过：仍存在遮挡操作的弹窗`)});\n    }`
            : ''
        }${
          shouldFailWhenFalse
            ? `\n    if (!${outputVar}) {\n      throw new Error(${JSON.stringify(`${step.label || outputVar} 未通过：页面未达到预期状态`)});\n    }`
            : ''
        }`;
      }
    case 'string':
      return `    const ${outputVar} = await agent.aiString(\`${prompt}\`);\n    console.log(${JSON.stringify(step.label || outputVar)}, ${outputVar});`;
    case 'number':
      return `    const ${outputVar} = await agent.aiNumber(\`${prompt}\`);\n    console.log(${JSON.stringify(step.label || outputVar)}, ${outputVar});`;
    default:
      return `    await agent.aiAct(\`${prompt}\`);`;
  }
}

function buildAndroidStepScript(input: {
  scriptName: string;
  promptTitle?: string;
  sourcePrompt?: string;
  steps: ScriptStepRecord[];
}) {
  const activeSteps = normalizeRuntimeSteps(input.steps).filter((step) => step.enabled !== false);
  const stepBlocks = activeSteps
    .map((step, index) => {
      const meta = serializeStep(step, index);
      const timeoutMultiplier = getRepeatCount(step);
      return `  emitStep('start', ${meta});
  try {
    await runStepWithTimeout(async () => {
${buildAndroidStepCall(step, index)}
    }, ${meta}, ${timeoutMultiplier});
    emitStep('success', ${meta});
  } catch (error) {
    emitStep('error', { ...${meta}, detail: error instanceof Error ? error.message : String(error) });
    throw error;
  }`;
    })
    .join('\n\n');

  return `import { agentFromAdbDevice } from '@midscene/android';

const STEP_EVENT_PREFIX = ${JSON.stringify(STEP_EVENT_PREFIX)};
const STEP_TIMEOUT_MS = Number(process.env.MIDSCENE_STEP_TIMEOUT_MS || 60000);

function emitStep(type, payload) {
  console.log(STEP_EVENT_PREFIX + JSON.stringify({ type, ...payload }));
}

async function runStepWithTimeout(task, payload, timeoutMultiplier = 1) {
  let timer;
  const timeoutMs = STEP_TIMEOUT_MS * Math.max(1, Number(timeoutMultiplier) || 1);
  try {
    await Promise.race([
      task(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(\`步骤「\${payload.title}」执行超过 \${Math.round(timeoutMs / 1000)} 秒，已自动停止。\`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const deviceId = process.env.ANDROID_SERIAL;
  const agent = await agentFromAdbDevice(deviceId);

  try {
    console.log(${JSON.stringify(`开始执行：${input.scriptName}`)});
${stepBlocks || '    console.log("没有可执行步骤");'}
  } finally {
    await agent.destroy?.();
  }
}

main().catch((error) => {
  console.error(error);
  setTimeout(() => process.exit(1), 50);
});
`;
}

function resolveExecutableCode(input: {
  code: string;
  scriptName: string;
  promptTitle?: string;
  sourcePrompt?: string;
  steps?: ScriptStepRecord[];
}) {
  if (input.steps?.some((step) => step.enabled !== false)) {
    return buildAndroidStepScript({
      scriptName: input.scriptName,
      promptTitle: input.promptTitle,
      sourcePrompt: input.sourcePrompt,
      steps: input.steps,
    });
  }

  return input.code;
}

export type RunGeneratedScriptEvent =
  | { type: 'operation'; operation: unknown }
  | { type: 'output'; chunk: string }
  | { type: 'step'; status: 'start' | 'success' | 'error'; index: number; id?: string; title?: string; detail?: string }
  | { type: 'done'; success: boolean; output: string; filePath: string };

export async function runGeneratedScript(input: {
  code: string;
  scriptName: string;
  promptTitle?: string;
  sourcePrompt?: string;
  deviceId?: string;
  steps?: ScriptStepRecord[];
  signal?: AbortSignal;
  onEvent?: (event: RunGeneratedScriptEvent) => void;
}) {
  const runDir = appPath('.midscene-generated');
  fs.mkdirSync(runDir, { recursive: true });

  const fileName = `${toScriptFileName(input.scriptName).replace(/\.ts$/, '')}-${Date.now()}.ts`;
  const filePath = path.join(runDir, fileName);
  fs.writeFileSync(filePath, injectMidsceneEnv(resolveExecutableCode(input)), 'utf8');

  return await new Promise<{ success: boolean; output: string; filePath: string }>((resolve) => {
    const child = spawn(process.execPath, [tsxBin, filePath], {
      cwd: appDataPath(),
      env: {
        ...process.env,
        MIDSCENE_RECORD_MODEL_CALL: 'true',
        ...(input.deviceId ? { ANDROID_SERIAL: input.deviceId } : {}),
      },
    });

    let output = '';
    let stdoutBuffer = '';
    let settled = false;
    let aborted = false;

    const settle = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', abortRun);
      const result = {
        success: aborted ? false : success,
        output: output.trim(),
        filePath,
      };
      input.onEvent?.({ type: 'done', ...result });
      resolve(result);
    };

    const killChild = () => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 2_000);
    };

    const abortRun = () => {
      if (settled || aborted) return;
      aborted = true;
      const message = '脚本执行已停止。';
      output += `${message}\n`;
      input.onEvent?.({ type: 'output', chunk: `${message}\n` });
      killChild();
    };

    const handleLine = (line: string) => {
      if (!line) return;
      if (line.startsWith(STEP_EVENT_PREFIX)) {
        try {
          const event = JSON.parse(line.slice(STEP_EVENT_PREFIX.length)) as {
            type?: 'start' | 'success' | 'error';
            index?: number;
            id?: string;
            title?: string;
            detail?: string;
          };
          if (event.type && typeof event.index === 'number') {
            input.onEvent?.({
              type: 'step',
              status: event.type,
              index: event.index,
              id: event.id,
              title: event.title,
              detail: event.detail,
            });
          }
        } catch {
          // Keep malformed marker lines out of the user-facing log.
        }
        return;
      }
      output += `${line}\n`;
      input.onEvent?.({ type: 'output', chunk: `${line}\n` });
    };

    const timeout = setTimeout(() => {
      const message = `脚本执行超过 ${Math.round(SCRIPT_TIMEOUT_MS / 1000)} 秒，已自动终止。`;
      output += `${message}\n`;
      input.onEvent?.({ type: 'output', chunk: `${message}\n` });
      killChild();
    }, SCRIPT_TIMEOUT_MS);

    if (input.signal?.aborted) {
      abortRun();
    } else {
      input.signal?.addEventListener('abort', abortRun, { once: true });
    }

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        handleLine(line);
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      input.onEvent?.({ type: 'output', chunk: text });
    });

    child.on('close', (code) => {
      if (stdoutBuffer) {
        handleLine(stdoutBuffer);
        stdoutBuffer = '';
      }
      settle(code === 0);
    });

    child.on('error', (error) => {
      output += `${error.message}\n`;
      input.onEvent?.({ type: 'output', chunk: `${error.message}\n` });
      settle(false);
    });
  });
}

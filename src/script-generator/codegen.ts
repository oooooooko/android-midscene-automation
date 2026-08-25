import type { ScriptForm, ScriptStep } from './types';

const safeVar = (value: string, fallback: string) => {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_$]+/g, '_').replace(/^(\d)/, '_$1');
  return normalized || fallback;
};

const escapeTemplate = (value: string) => value.replace(/`/g, '\\`');

function getRepeatCount(step: ScriptStep) {
  const repeat = Number(step.repeat || 1);
  if (!Number.isFinite(repeat)) return 1;
  return Math.max(1, Math.min(10, Math.floor(repeat)));
}

function withRepeat(step: ScriptStep, body: string) {
  const repeat = getRepeatCount(step);
  if (repeat <= 1) return body;

  const inner = body
    .split('\n')
    .map((line) => `    ${line.replace(/^  /, '')}`)
    .join('\n');

  return `  for (let attempt = 1; attempt <= ${repeat}; attempt += 1) {
    console.log(${JSON.stringify(`执行${step.label || step.type}`)}, attempt);
${inner}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }`;
}

// 瞬时提示可能在下一次单帧截图前消失，因此只对明确标记的动作开启观察窗口。
function withObservation(step: ScriptStep, index: number, body: string) {
  const assertion = step.observePrompt?.trim();
  if (!assertion) return body;

  const observerVar = `observer${index + 1}`;
  const nestedBody = body
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

  return `  const ${observerVar} = await agent.startObserving({ intervalMs: 500, maxFrames: 20 });
  try {
${nestedBody}
  } finally {
    await ${observerVar}.stop();
  }
  await ${observerVar}.aiAssert(\`${escapeTemplate(assertion)}\`);`;
}

function getBooleanFailureRule(step: ScriptStep, outputVar: string) {
  const signalText = `${outputVar} ${step.label}`;
  const shouldFailWhenTrue =
    /has.*(modal|popup|dialog|blocking)|hasBlocking|blockingModal/i.test(signalText) ||
    step.label.includes('确认无干扰弹窗') ||
    step.label.includes('遮挡弹窗');
  const shouldFailWhenFalse =
    /is.*(ready|loaded|success)|isLoginReady|loginReady/i.test(signalText) ||
    step.label.includes('验证登录页就绪') ||
    step.label.includes('登录页就绪');
  return { shouldFailWhenTrue, shouldFailWhenFalse };
}

function buildStep(step: ScriptStep, index: number) {
  const prompt = escapeTemplate(step.prompt);
  switch (step.type) {
    case 'comment':
      return `  // ${step.label || step.prompt}`;
    case 'waitFor':
      return `  await agent.aiWaitFor(\`${prompt}\`);`;
    case 'act':
      return withObservation(step, index, withRepeat(step, `  await agent.aiAct(\`${prompt}\`);`));
    case 'tap':
      return withObservation(step, index, withRepeat(step, `  await agent.aiTap(\`${prompt}\`);`));
    case 'input':
      return withObservation(
        step,
        index,
        `  await agent.aiInput(\`${prompt}\`, { value: ${JSON.stringify(step.value || '')} });`,
      );
    case 'query':
      return `  const ${safeVar(step.outputVar || 'result', 'result')} = await agent.aiQuery(${JSON.stringify(step.prompt)});\n  console.log(${JSON.stringify(step.label || step.outputVar || 'query result')}, ${safeVar(step.outputVar || 'result', 'result')});`;
    case 'boolean':
      {
        const outputVar = safeVar(step.outputVar || 'flag', 'flag');
        const { shouldFailWhenTrue, shouldFailWhenFalse } = getBooleanFailureRule(step, outputVar);
        return `  const ${outputVar} = await agent.aiBoolean(\`${prompt}\`);\n  console.log(${JSON.stringify(step.label || step.outputVar || 'boolean result')}, ${outputVar});${
          shouldFailWhenTrue
            ? `\n  if (${outputVar}) {\n    throw new Error(${JSON.stringify(`${step.label || outputVar} 未通过：仍存在遮挡登录操作的弹窗`)});\n  }`
            : ''
        }${
          shouldFailWhenFalse
            ? `\n  if (!${outputVar}) {\n    throw new Error(${JSON.stringify(`${step.label || outputVar} 未通过：页面未达到预期状态`)});\n  }`
            : ''
        }`;
      }
    case 'string':
      return `  const ${safeVar(step.outputVar || 'text', 'text')} = await agent.aiString(\`${prompt}\`);\n  console.log(${JSON.stringify(step.label || step.outputVar || 'string result')}, ${safeVar(step.outputVar || 'text', 'text')});`;
    case 'number':
      return `  const ${safeVar(step.outputVar || 'count', 'count')} = await agent.aiNumber(\`${prompt}\`);\n  console.log(${JSON.stringify(step.label || step.outputVar || 'number result')}, ${safeVar(step.outputVar || 'count', 'count')});`;
  }
}

export function buildScript(form: ScriptForm, steps: ScriptStep[]) {
  const activeSteps = steps.filter((step) => step.enabled);

  return `import { agentFromAdbDevice } from '@midscene/android';

async function main() {
  const agent = await agentFromAdbDevice(process.env.ANDROID_SERIAL);

  try {
    // ${form.promptTitle}
${activeSteps.map((step, index) => buildStep(step, index)).join('\n')}
  } finally {
    await agent.destroy?.();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;
}

import OpenAI from 'openai';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config';

const allowedTypes = new Set([
  'comment',
  'waitFor',
  'act',
  'tap',
  'input',
  'query',
  'boolean',
  'string',
  'number',
]);

const systemPrompt = `你是一个 Midscene 自动化脚本规划器。

目标：把中文自动化需求拆成适合 Midscene Android 自动化的结构化步骤。

规则：
1. 参考 Midscene 示例项目的写法：输出稳定的结构化脚本步骤，每一步可以是短自然语言指令；不要输出“整段自然语言一次性跑完整用例”的巨型 aiAct。
2. 默认生成低模型调用脚本，避免为了稳妥堆叠重复判断。每个 aiAct、aiTap、aiInput、aiWaitFor、aiBoolean、aiQuery 都可能触发模型调用，能少一步就少一步。
3. 合理混用 aiAct、aiWaitFor、aiTap、aiInput、aiQuery、aiBoolean、aiString、aiNumber。
4. 只有在确实适合注释时才使用 comment。
5. 输出必须是 JSON 对象，不要输出 markdown。
6. JSON 结构如下：
{
  "promptTitle": "场景标题",
  "steps": [
    {
      "type": "act | waitFor | tap | input | query | boolean | string | number | comment",
      "label": "步骤标题",
      "prompt": "描述",
      "outputVar": "可选，仅 query/boolean/string/number 时使用",
      "value": "可选，仅 input 时使用",
      "observePrompt": "可选，仅 act/tap/input 时使用；描述执行该动作期间需要捕获的瞬时界面现象",
      "repeat": "可选数字，仅 act/tap 可使用，表示重复执行次数",
      "enabled": true
    }
  ]
}
7. 通用测试场景默认按“进入/确认目标 App -> 处理启动阶段遮挡 -> 等待起始页面稳定 -> 执行核心业务动作 -> 等待结果页面或读取结果”的结构拆分。不要只生成一条巨型 act，也不要为同一状态生成重复验证。
8. 如果需求涉及某个 App，第一条可执行步骤只做轻量进入/确认目标 App：若当前已在目标 App 内则保持当前状态；若不在目标 App 内，使用包名打开目标 App 并等待首屏，不要描述“查找桌面图标/从最近任务选择”等视觉搜索过程。启动后不要再生成额外 boolean 确认。
9. 如果原始需求里有“遇到弹窗则关闭/允许/跳过”这类策略，生成 1 条启动阶段总括 act 步骤即可，默认 repeat: 1；只有用户明确要求“反复处理/直到没有/所有弹窗”时才设置 repeat: 2。prompt 要写清楚只检查权限、启动协议、广告、更新、活动、通知引导等启动阶段弹窗；如果没有弹窗，不要点击业务内容、表单字段、复选框或提交按钮。
10. 所有场景都要把输入、点击、等待结果拆成独立步骤。输入使用 input，明确点击使用 tap，条件式处理使用 act，页面稳定使用 waitFor，读取数据使用 query/string/number，真假判断使用 boolean。
11. 所有定位 prompt 都要具体到页面、区域、附近文本或业务含义，例如“搜索页顶部搜索框”“设备列表中的第一个在线设备”“详情页右上角设置按钮”。不要写“输入框”“按钮”“列表项”等泛化描述。
12. 所有 input 的 value 必须完全来自原始需求；不得改写、脱敏、复用历史值或编造示例值。aiInput 步骤中 prompt 只表示输入框定位描述，value 表示要输入的内容。
13. 结果验证默认用 1 条 waitFor 写正向、可观察的成功信号，例如目标页面标题、列表项、详情页核心元素、提交成功页、设备状态变化。不要默认追加长串失败排除条件；只有用户明确要求校验失败原因时，才额外生成错误提示读取或失败断言。
14. 每个 boolean 步骤只能问一个真假问题；默认不要为了确认当前页面状态而生成 boolean，优先使用 waitFor 作为稳定状态验证。不要生成“waitFor + boolean”重复判断同一结果。
15. 条件式 no-op 动作会增加模型调用，只有确实存在分支时才生成。如果一个动作步骤的 prompt 包含“如果存在/若出现/如果当前不是/如果未勾选/如果已经/否则跳过/保持当前状态”，不能使用 tap；应使用单次 act，或者先用 boolean 判断后再生成确定目标的 tap，但不要两者都生成。
16. “处理弹窗/关闭弹窗/允许权限/同意协议”必须使用 act 或 tap，因为 boolean/query 只会判断或读取，不会点击按钮。
17. 生成步骤时必须参考后续提供的 Midscene 文档内容，尤其是 JavaScript 优化建议、aiAct/aiTap/aiInput/aiWaitFor/aiQuery/aiBoolean/aiString/aiNumber 的职责边界和用法。
18. 不要生成 Midscene 文档中不存在的 API 名称。当前只输出结构化 JSON steps，由代码生成器映射为对应的 Midscene API。
19. 优先套用后续 Midscene 脚本生成参考中的拆分策略、步骤标题规范、通用场景模板、登录场景模板、弹窗处理模板和失败验证规则。
20. Midscene 1.10.4 支持 startObserving/UIObserver。只有原始需求明确需要验证动作过程中一闪而过的 Toast、短暂错误提示、Banner、加载状态或自动消失控件时，才给触发该现象的 act/tap/input 步骤填写 observePrompt；如果不需要验证瞬时现象，必须省略该字段。
21. observePrompt 必须描述一个肯定、可观察的历史事件，例如“点击保存后，执行过程中出现过保存成功提示”。不要用它判断最终页面是否稳定、当前是否仍有弹窗、是否进入结果页等持续状态，这些情况默认只用 aiWaitFor。
22. observePrompt 应挂在直接触发现象的动作步骤上，不要挂在启动 App、循环处理弹窗或等待步骤上。即使观察到了成功 Toast，只要用户把“进入结果页/列表更新/状态变化”作为成功标准，仍必须生成最终页面的 waitFor；不要再默认补结果 boolean。
23. 登录场景默认控制在 7 到 9 个可执行步骤：进入/确认 App、处理启动弹窗、等待登录页、必要时进入账号密码登录、输入账号、输入密码、必要时勾选协议、提交登录、等待首页。最终默认用 waitFor 作为成功判定；只有用户明确要求读取布尔结果、错误原因或断言日志时，才额外生成 boolean/string/query。
24. 登录场景必须先从原始需求中抽取账号、密码、验证码等输入值；所有后续步骤必须复用完全相同的字面量，禁止把邮箱改成手机号、把手机号改成邮箱、使用历史账号、示例账号或自行编造账号。
25. 登录表单必须拆分：账号输入是独立 input，密码输入是独立 input，登录按钮是独立 tap。登录协议勾选框只有在页面/需求明确需要时才生成独立处理步骤。不要用一条 act 同时输入账号、输入密码、勾选协议和点击登录。
26. 登录按钮步骤必须使用 tap，prompt 只描述点击当前页面的登录按钮，例如“点击登录页中的登录按钮，提交当前已填写的表单；不要修改账号、密码或其他输入框”。不要在登录按钮 prompt 中重新写账号或密码，也不要追加“如果软键盘遮挡”等条件式子句。
27. 简单且目标确定可见的点击优先使用 tap。登录按钮适合 tap；只有明确当前不在账号密码登录页时，账号密码登录入口才适合 tap；只有明确协议未勾选时，登录协议勾选框才适合 tap。
28. 如果步骤语义是“如果当前不是账号密码登录页则点击入口，否则保持当前状态”，必须使用单次 act，不要用 tap。
29. 如果步骤语义是“如果协议未勾选则勾选，已勾选或没有复选框则保持当前状态”，必须使用单次 act，避免 tap 反选已勾选的协议。
30. 登录协议勾选框、登录按钮和登录后协议确认弹窗不能设置 repeat；每个步骤最多点击一次，后续用 waitFor 判断是否成功，避免再补重复 boolean。
31. 如果等待登录页后还可能停留在欢迎页、手机号登录页、微信登录页或其他非账号密码登录页，必须在输入账号前生成单次 act：如果当前不是账号密码登录页，点击账号密码登录入口或切换到账号密码登录方式；如果当前已经显示账号和密码输入框，则保持当前状态。
32. 登录账号输入框 prompt 必须根据已选择的登录方式精确定位：账号密码登录页中写“账号密码登录页中的账号或邮箱输入框”；手机号登录页中写“手机号登录页中的手机号输入框”。不要写“手机号、账号或邮箱输入框”这种会匹配多个字段的泛化描述。
33. 登录协议勾选 prompt 必须说明只点击复选框本身，不点击用户协议、隐私政策等文本链接。
34. 登录成功后的 waitFor 默认只写正向成功信号：等待首页或主界面稳定显示，出现设备列表、添加设备入口、底部导航、用户头像或我的页面入口等首页核心元素之一。不要默认追加长串失败排除条件；只有用户明确要求校验失败原因时，才额外生成错误提示读取或失败断言。
35. 协议确认弹窗和“再次提交登录”不是登录脚本的默认步骤。只有原始需求明确提到点击登录后会出现服务协议/隐私政策/声明与条款确认弹窗，或上下文明确该 App 存在这个二次确认，才生成这两个条件式 act 步骤。`;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const midsceneDocsDir = path.join(projectRoot, 'docs', 'midscene');
const midsceneDocPaths = {
  scriptGenerationReference: path.join(midsceneDocsDir, 'script-generation-reference.md'),
  optimize: path.join(midsceneDocsDir, 'use-javascript-to-optimize-ai-automation-code.md'),
  api: path.join(midsceneDocsDir, 'api.md'),
};

function readMidsceneDoc(filePath: string) {
  if (!existsSync(filePath)) return '';
  return readFileSync(filePath, 'utf8');
}

function excerptAround(content: string, pattern: RegExp, radius = 1800) {
  const match = pattern.exec(content);
  if (!match || match.index === undefined) return '';

  const start = Math.max(0, match.index - radius);
  const end = Math.min(content.length, match.index + match[0].length + radius);
  return content.slice(start, end).trim();
}

function buildMidsceneDocsContext() {
  const mergedReference = readMidsceneDoc(midsceneDocPaths.scriptGenerationReference);
  if (mergedReference) {
    return [
      '下面是本项目整理后的 Midscene 脚本生成参考。你必须参考这些内容规划脚本步骤，但最终仍只能输出前面约定的 JSON 对象。',
      `文档路径：${midsceneDocPaths.scriptGenerationReference}`,
      mergedReference,
    ].join('\n\n');
  }

  const optimizeDoc = readMidsceneDoc(midsceneDocPaths.optimize);
  const apiDoc = readMidsceneDoc(midsceneDocPaths.api);

  // 兜底逻辑：合并参考文件不存在时，从原始文档抽取当前脚本生成会用到的 API 片段。
  const apiSnippets = [
    excerptAround(apiDoc, /agent\.aiAct\(\)/i),
    excerptAround(apiDoc, /agent\.aiTap\(\)/i),
    excerptAround(apiDoc, /agent\.aiInput\(\)/i),
    excerptAround(apiDoc, /agent\.aiQuery\(\)/i),
    excerptAround(apiDoc, /agent\.aiBoolean\(\)/i),
    excerptAround(apiDoc, /agent\.aiNumber\(\)/i),
    excerptAround(apiDoc, /agent\.aiString\(\)/i),
    excerptAround(apiDoc, /agent\.aiWaitFor\(\)/i),
    excerptAround(apiDoc, /startObserving/i),
    excerptAround(apiDoc, /deepLocate/i),
  ].filter(Boolean);

  return [
    '下面是本项目保存的 Midscene 官方文档参考。你必须参考这些内容规划脚本步骤，但最终仍只能输出前面约定的 JSON 对象。',
    `文档路径：${midsceneDocPaths.optimize}`,
    `文档路径：${midsceneDocPaths.api}`,
    '## use-javascript-to-optimize-ai-automation-code.md',
    optimizeDoc || '未读取到该文档。',
    '## api.md 相关片段',
    Array.from(new Set(apiSnippets)).join('\n\n---\n\n') || '未读取到相关 API 文档片段。',
  ].join('\n\n');
}

function stripThinking(content: string) {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function extractJson(content: string) {
  const clean = stripThinking(content);
  const fenceMatch = clean.match(/```json\s*([\s\S]*?)```/i) || clean.match(/```\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return clean.slice(start, end + 1);
  }

  return clean;
}

function normalizeStep(step: Record<string, unknown>) {
  const rawType = typeof step.type === 'string' && allowedTypes.has(step.type) ? step.type : 'act';
  const hasRepeat = step.repeat !== undefined && step.repeat !== null && step.repeat !== '';
  const rawRepeat = Number(step.repeat);
  const labelText = typeof step.label === 'string' ? step.label : '';
  const promptText = typeof step.prompt === 'string' ? step.prompt : '';
  const isStartupPopupHandling = /(处理|关闭|循环处理).*(启动)?弹窗|启动阶段.*弹窗/.test(labelText);
  const isSoftKeyboardLoginHint = /(软键盘|键盘遮挡)/.test(promptText) && /(登录按钮|提交登录|提交当前已填写)/.test(promptText);
  const isConditionalNoopAction =
    !isSoftKeyboardLoginHint &&
    /(如果|若|如有|如果当前|如果.*未勾选|已勾选|不存在.*跳过|则跳过|保持当前|否则)/.test(promptText);
  const isConditionalNoopTap =
    rawType === 'tap' &&
    isConditionalNoopAction;
  const isLoginOneShotAction =
    (rawType === 'act' || rawType === 'tap') &&
    !isStartupPopupHandling &&
    !isConditionalNoopAction &&
    (
      /(登录按钮|提交登录|登录提交|账号密码登录入口|登录协议|协议勾选|勾选.*协议|复选框|同意协议弹窗|协议确认弹窗)/.test(labelText) ||
      /^(点击登录页中的登录按钮|登录页中的登录按钮|登录页底部.*勾选框|.*协议.*确认.*按钮|.*同意.*按钮)/.test(promptText)
    );
  const type = rawType === 'act' && isLoginOneShotAction ? 'tap' : isConditionalNoopTap ? 'act' : rawType;
  const supportsObservation = type === 'act' || type === 'tap' || type === 'input';
  const fallbackRepeat = 1;
  const repeat = Math.max(1, Math.min(10, Math.floor(hasRepeat && Number.isFinite(rawRepeat) ? rawRepeat : fallbackRepeat)));
  return {
    type,
    label: typeof step.label === 'string' ? step.label : '未命名步骤',
    prompt: typeof step.prompt === 'string' ? step.prompt : '',
    outputVar: typeof step.outputVar === 'string' ? step.outputVar : '',
    value: typeof step.value === 'string' ? step.value : '',
    observePrompt: supportsObservation && typeof step.observePrompt === 'string' ? step.observePrompt.trim() : '',
    repeat: isLoginOneShotAction ? 1 : repeat,
    enabled: step.enabled !== false,
  };
}

function isMixedLoginBlockingBoolean(step: ReturnType<typeof normalizeStep>) {
  if (step.type !== 'boolean') return false;
  const text = `${step.label} ${step.prompt}`;
  return (
    text.includes('是否还存在') &&
    /(登录页|登录相关|登录流程|就绪|稳定|入口)/.test(text) &&
    /(遮挡|弹窗|权限|协议|广告|更新|活动)/.test(text)
  );
}

function normalizeSteps(steps: Array<Record<string, unknown>>) {
  return steps.flatMap((step) => {
    const normalized = normalizeStep(step);
    if (!isMixedLoginBlockingBoolean(normalized)) {
      return [normalized];
    }

    return [
      {
        type: 'boolean',
        label: '确认无干扰弹窗',
        prompt: '当前页面是否还存在会遮挡登录操作的弹窗，例如权限、协议、广告、更新或活动弹窗？',
        outputVar: 'hasBlockingModal',
        value: '',
        enabled: normalized.enabled,
      },
      {
        type: 'boolean',
        label: '验证登录页就绪',
        prompt: '当前页面是否已稳定停留在目标 App 的登录页、手机号登录页、账号密码登录页，或显示可进入登录流程的入口？',
        outputVar: 'isLoginReady',
        value: '',
        enabled: normalized.enabled,
      },
    ];
  });
}

export async function generatePlan(input: { prompt: string }) {
  const startedAt = Date.now();
  const config = loadConfig();

  if (!config.scriptOptimizer.model.apiKey) {
    throw new Error('Missing scriptOptimizer.model.apiKey in config.json');
  }

  const client = new OpenAI({
    apiKey: config.scriptOptimizer.model.apiKey,
    baseURL: config.scriptOptimizer.model.baseUrl,
  });

  const completion = await client.chat.completions.create({
    model: config.scriptOptimizer.model.name,
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'system', content: buildMidsceneDocsContext() },
      {
        role: 'user',
        content: JSON.stringify(
          {
            prompt: input.prompt,
          },
          null,
          2,
        ),
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Model returned empty content');
  }

  const parsed = JSON.parse(extractJson(content)) as {
    promptTitle?: string;
    steps?: Array<Record<string, unknown>>;
  };

  return {
    promptTitle: parsed.promptTitle || 'AI 生成脚本',
    steps: Array.isArray(parsed.steps) ? normalizeSteps(parsed.steps) : [],
    raw: content,
    durationMs: Date.now() - startedAt,
    usage: {
      promptTokens: completion.usage?.prompt_tokens,
      completionTokens: completion.usage?.completion_tokens,
      totalTokens: completion.usage?.total_tokens,
    },
  };
}

import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { PNG } from 'pngjs';
import { isAiRecognitionModelConfigured, validateAiRecognitionPrompt } from '../src/appium-recorder/ai-recognition';
import { defaultFlowKind, flowBranchLabel, labelFlowStep } from '../src/appium-recorder/flow-labels';
import { buildFlowGraph } from '../src/appium-recorder/flow-graph';
import { createFlowClipboard, pasteFlowClipboard } from '../src/appium-recorder/flow-copy';
import { removeFlowStep } from '../src/appium-recorder/flow-remove';
import { formatStageLog, validateStageLog } from '../src/appium-recorder/stage-log';
import { textClickSelector } from '../src/appium-recorder/text-click';
import type { AppiumRecordedStep } from '../src/appium-recorder/types';

const root = await mkdtemp(join(tmpdir(), 'ai-recognition-check-'));
assert.equal(formatStageLog({ value: 'xxxxx' }), 'stageLog:xxxxx');
assert.equal(formatStageLog({ logPrefix: 'login', value: '第一行\n第二行' }), 'login:第一行\nlogin:第二行');
assert.ok(validateStageLog({ value: '' }));
assert.ok(validateStageLog({ value: 'x', logPrefix: '\n' }));
assert.equal(formatStageLog({ value: '${notExecuted}' }), 'stageLog:${notExecuted}');
const savedEnv = { ...process.env };
const originalExecFile = childProcess.execFile;
const originalFetch = globalThis.fetch;
let modelContent = '{"result":true,"reason":"按钮可用"}';
let finishReason = 'stop';
let modelStatus = 200;
let textMatches = 1;
let textClickError = false;
let textClicks = 0;
let lastTextQuery = '';
let screenshots = 0;
let modelCalls = 0;
let holdResponse = false;
let onModelRequest: (() => void) | undefined;
let lastModelRequest: any;
let httpServer: ReturnType<typeof createServer> | undefined;

try {
  const sdk = join(root, 'sdk');
  const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  await mkdir(join(sdk, 'platform-tools'), { recursive: true });
  await writeFile(adb, '');
  Object.assign(process.env, { ANDROID_MIDSCENE_DATA_ROOT: root, ANDROID_SDK_ROOT: sdk, ANDROID_HOME: sdk, APPIUM_SERVER_URL: 'http://appium-test.invalid' });
  childProcess.execFile = ((command, args, optionsOrCallback, callback) => {
    assert.equal(command, adb);
    assert.ok(!args.includes('input'), 'Recognition must not operate the device');
    const done = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    const png = new PNG({ width: 2, height: 2 });
    png.data.fill(++screenshots % 255);
    queueMicrotask(() => done(null, args.includes('screencap') ? PNG.sync.write(png) : '', ''));
    return {};
  }) as typeof childProcess.execFile;
  syncBuiltinESMExports();
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host === 'model-test.invalid') {
      modelCalls++;
      lastModelRequest = JSON.parse(String(init?.body));
      assert.equal(url.pathname, '/v1/chat/completions');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fake-key');
      onModelRequest?.();
      if (holdResponse) return new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) reject(init.signal.reason);
        else init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      });
      return modelStatus !== 200
        ? Response.json({ error: { message: 'fake-key must not leak' } }, { status: modelStatus })
        : Response.json({ choices: [{ finish_reason: finishReason, message: { content: modelContent, role: 'assistant' } }] });
    }
    assert.equal(url.host, 'appium-test.invalid', 'No real model or device service may be contacted');
    if (url.pathname.endsWith('/elements')) {
      lastTextQuery = JSON.parse(String(init?.body)).value;
      return Response.json({ value: Array.from({ length: textMatches }, (_, index) => ({ ELEMENT: `text-${index}` })) });
    }
    if (url.pathname.endsWith('/click')) {
      textClicks++;
      return textClickError ? Response.json({ value: { error: 'element not interactable', message: 'cannot click' } }, { status: 400 }) : Response.json({ value: null });
    }
    if (url.pathname === '/session') return Response.json({ value: { sessionId: 'test-session' } });
    return Response.json({ value: null });
  };

  const { loadConfig, saveConfig } = await import('../server/config');
  const { recognizeDeviceScreen, parseAiRecognitionResult } = await import('../server/appium-recorder/ai-recognition');
  const config = loadConfig();
  config.appium.flowBackgroundColor = '#AbC';
  saveConfig(config);
  assert.equal(loadConfig().appium.flowBackgroundColor, '#aabbcc');
  assert.throws(() => saveConfig({ ...config, appium: { ...config.appium, flowBackgroundColor: 'invalid' } }), /十六进制/);
  config.appium.flowBackgroundColor = '#aabbcc';
  assert.deepEqual(config.appium.model, { baseUrl: '', apiKey: '', name: '' });
  assert.equal(isAiRecognitionModelConfigured(config.appium.model), false);
  assert.equal(isAiRecognitionModelConfigured({ baseUrl: 'x', apiKey: ' ', name: 'y' }), false);
  assert.throws(() => validateAiRecognitionPrompt('  '), /识别内容/);
  assert.throws(() => validateAiRecognitionPrompt('x'.repeat(4001)), /4000/);
  await assert.rejects(recognizeDeviceScreen({ deviceId: 'test', prompt: '黑屏吗' }), /Appium配置/);
  assert.equal(modelCalls, 0);
  config.appium.model = { baseUrl: 'http://model-test.invalid/v1', apiKey: 'fake-key', name: 'vision-test' };
  saveConfig(config);
  const { loadModelConfigFromDb } = await import('../server/config-store');
  assert.deepEqual(loadModelConfigFromDb()?.appium, config.appium);
  const oldConfig = { ...config };
  delete (oldConfig as Partial<typeof config>).appium;
  saveConfig(oldConfig);
  assert.equal(isAiRecognitionModelConfigured(loadConfig().appium.model), false, 'Old config loads with empty Appium model');
  saveConfig(config);

  for (const invalid of ['false', '{"result":"false"}', '{"result":null}', '{"result":1}', 'not JSON', '{}']) {
    assert.throws(() => parseAiRecognitionResult(invalid));
  }
  assert.deepEqual(parseAiRecognitionResult('```json\n{"result":false,"reason":"无黑屏"}\n```'), { result: false, reason: '无黑屏' });
  const first = await recognizeDeviceScreen({ deviceId: 'test', prompt: '识别当前按钮是否可用' });
  assert.equal(first.result, true);
  assert.equal(lastModelRequest.messages[1].content[0].text, '识别当前按钮是否可用');
  assert.equal(lastModelRequest.messages[1].content[1].image_url.url, `data:image/png;base64,${first.imageBase64}`);
  assert.notEqual((await recognizeDeviceScreen({ deviceId: 'test', prompt: '识别当前按钮是否可用' })).imageBase64, first.imageBase64, 'Each test captures a fresh image');

  const steps: AppiumRecordedStep[] = [
    { id: 'ai', type: 'aiRecognition', label: 'AI 识别', value: '检查有没有黑屏', flow: { nodeKind: 'condition', yesTargetId: 'true', noTargetId: 'false' } },
    { id: 'true', type: 'log', label: 'True action', value: 'true branch', flow: { parentConditionId: 'ai', parentBranch: 'yes' } },
    { id: 'false', type: 'log', label: 'False action', logPrefix: 'customLog', value: 'false branch', flow: { parentConditionId: 'ai', parentBranch: 'no' } },
  ];
  assert.equal(defaultFlowKind({ ...steps[0], flow: { nodeKind: 'action' } }), 'condition');
  assert.equal(flowBranchLabel(steps[0], 'no'), 'false');
  for (const configured of [true, false]) {
    const graph = buildFlowGraph(steps, {
      aiRecognitionModelConfigured: configured,
      expandedStepIndex: null, selectedCopyIndexes: [], copyMode: false, canOpenInsertMenu: true,
      isStartActionDisabled: () => false, isInsertActionDisabled: () => false, isAppExecutionDisabled: () => false,
      startActionGroups: [], mainActionGroups: [], labelStep: labelFlowStep, isCopySelected: () => false,
    });
    const node = graph.nodes.find((item) => item.data.kind === 'step' && item.data.step.type === 'aiRecognition')!;
    assert.ok(node.data.kind === 'step' && node.data.canExecute && node.data.missingAiModel === !configured);
    assert.deepEqual(graph.nodes.flatMap((item) => item.data.kind === 'branch' ? [item.data.label] : []), ['true', 'false']);
  }
  let nextId = 0;
  const copied = pasteFlowClipboard([], createFlowClipboard(steps, [0]), { afterIndex: -1 }, () => `copy-${++nextId}`);
  assert.equal(copied[0].value, steps[0].value);
  assert.equal(copied[0].flow?.noTargetId, copied[2].id);
  assert.equal(removeFlowStep(steps, 1).find((step) => step.id === 'false')?.flow?.parentBranch, 'no');
  const { saveAppiumRecordedScript, getAppiumRecordedScript, importAppiumRecordedScript } = await import('../server/appium-recorder/repository');
  const script = saveAppiumRecordedScript({ name: 'AI check', appPackage: 'example.app', steps });
  assert.deepEqual(getAppiumRecordedScript(script.id)?.steps, steps);
  assert.deepEqual(importAppiumRecordedScript(script).steps, steps);
  const { replayAppiumScript } = await import('../server/appium-recorder/appium-runner');
  for (const result of [true, false]) {
    modelContent = JSON.stringify({ result, reason: '视觉依据' });
    const replay = await replayAppiumScript(script, 'test');
    assert.equal(replay.success, true);
    assert.ok(replay.output.includes(`开始：${result ? 'True' : 'False'} action`));
    assert.ok(!replay.output.includes(`开始：${result ? 'False' : 'True'} action`));
    assert.ok(replay.output.includes(result ? 'stageLog:true branch' : 'customLog:false branch'));
    assert.ok((await readFile(replay.htmlReportPath!, 'utf8')).includes(`判断：${result}；视觉依据`));
    assert.ok((await readFile(replay.reportPath!, 'utf8')).includes(`AI 识别：${result}`));
  }
  const streamed = [] as string[];
  const logReplay = await replayAppiumScript({ ...script, steps: [
    { id: 'log', type: 'log', label: '输出日志', value: '失败：这只是日志\n下一行', logPrefix: 'debug' },
    { id: 'after', type: 'noop', label: '日志后继续' },
  ] }, 'test', (line) => streamed.push(line));
  assert.equal(logReplay.success, true);
  assert.ok(streamed.some((line) => line.includes('debug:失败：这只是日志\ndebug:下一行')));
  assert.ok(logReplay.output.includes('开始：日志后继续'));
  assert.ok((await readFile(logReplay.logPath!, 'utf8')).includes('debug:下一行'));
  const logMarkdown = await readFile(logReplay.reportPath!, 'utf8');
  assert.ok(!logMarkdown.includes('| 执行状态 | **失败** |'));
  assert.ok(logMarkdown.includes('| 执行状态 | **成功** |'));
  assert.ok((await readFile(logReplay.htmlReportPath!, 'utf8')).includes('debug:下一行'));
  assert.throws(() => textClickSelector({ value: '  ' }), /请输入/);
  assert.equal(textClickSelector({ value: 'a"\\b', flow: { textMatch: 'exact' } }).value, 'new UiSelector().text("a\\"\\\\b")');
  const textStep: AppiumRecordedStep = {
    id: 'text', type: 'textClick', label: '文字点击', value: '音频设置', timeoutMs: 0,
    flow: { textMatch: 'exact', yesTargetId: 'matched', noTargetId: 'missing' },
  };
  const textScript = { ...script, steps: [textStep,
    { id: 'matched', type: 'log' as const, label: '找到', value: 'matched', flow: { parentConditionId: 'text', parentBranch: 'yes' as const } },
    { id: 'missing', type: 'log' as const, label: '未找到', value: 'missing', flow: { parentConditionId: 'text', parentBranch: 'no' as const } },
  ] };
  for (const count of [1, 0, 2]) {
    textMatches = count;
    textClicks = 0;
    textStep.flow!.textMatch = count === 0 ? 'contains' : 'exact';
    const result = await replayAppiumScript(textScript, 'test');
    assert.equal(result.success, count !== 2);
    assert.equal(textClicks, count === 1 ? 1 : 0);
    assert.ok(lastTextQuery.includes(count === 0 ? '.textContains(' : '.text('));
    if (count < 2) {
      assert.ok(result.output.includes(count ? '判断：匹配到文字' : '判断：未匹配到文字'));
      assert.ok(result.output.includes(count ? 'stageLog:matched' : 'stageLog:missing'));
      assert.ok(!result.output.includes(count ? 'stageLog:missing' : 'stageLog:matched'));
      assert.ok((await readFile(result.htmlReportPath!, 'utf8')).includes(count ? '判断：匹配到文字' : '判断：未匹配到文字'));
    } else assert.ok(result.output.includes('匹配到 2 个文字元素'));
  }
  textMatches = 1;
  textClickError = true;
  const clickFailure = await replayAppiumScript(textScript, 'test');
  assert.equal(clickFailure.success, false);
  assert.ok(!clickFailure.output.includes('stageLog:missing'));
  textClickError = false;
  for (const content of ['{"result":"false"}', '{"result":null}', 'I cannot judge']) {
    modelContent = content;
    const replay = await replayAppiumScript(script, 'test');
    assert.equal(replay.success, false);
    assert.ok(!replay.output.includes('开始：False action'));
  }
  modelContent = '{"result":false}';
  finishReason = 'length';
  await assert.rejects(recognizeDeviceScreen({ deviceId: 'test', prompt: '黑屏吗' }), /未完整/);
  finishReason = 'stop';
  modelStatus = 401;
  const failed = await replayAppiumScript(script, 'test');
  assert.equal(failed.success, false);
  assert.ok(!failed.output.includes('fake-key'));
  assert.ok(!failed.output.includes('开始：False action'));
  modelStatus = 200;

  holdResponse = true;
  const abort = new AbortController();
  onModelRequest = () => abort.abort(new Error('test stop'));
  const stopped = await replayAppiumScript(script, 'test', undefined, abort.signal);
  assert.equal(stopped.stopped, true);
  assert.ok(!stopped.output.includes('开始：False action'));
  onModelRequest = undefined;
  // Keep the event loop alive while the SDK is waiting on the simulated transport.
  const keepAlive = setInterval(() => {}, 100);
  try {
    await assert.rejects(recognizeDeviceScreen({ deviceId: 'test', prompt: '黑屏吗', timeoutMs: 1000 }), /超时/);
  } finally { clearInterval(keepAlive); }
  holdResponse = false;

  const { handleAppiumRecorderRequest } = await import('../server/appium-recorder/routes');
  httpServer = createServer((req, res) => { void handleAppiumRecorderRequest(req, res, 'test'); });
  await new Promise<void>((resolve) => httpServer!.listen(0, '127.0.0.1', resolve));
  const port = (httpServer.address() as { port: number }).port;
  const request = (prompt: unknown) => originalFetch(`http://127.0.0.1:${port}/api/appium-recorder/ai-recognition/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }),
  });
  const response = await request('黑屏吗');
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { result: boolean }).result, false);
  assert.equal((await request('')).status, 500);
  saveConfig({ ...config, appium: { model: { baseUrl: '', apiKey: '', name: '' } } });
  assert.equal((await request('黑屏吗')).status, 500);
  console.log('PASS: AI config persistence/migration, screenshots, strict booleans, routing/reports, errors/abort/timeout, copy/import/layout, HTTP test endpoint');
} finally {
  if (httpServer) await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
  childProcess.execFile = originalExecFile;
  syncBuiltinESMExports();
  globalThis.fetch = originalFetch;
  for (const key of ['ANDROID_MIDSCENE_DATA_ROOT', 'ANDROID_SDK_ROOT', 'ANDROID_HOME', 'APPIUM_SERVER_URL', 'PATH']) {
    if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
  }
  await rm(root, { recursive: true, force: true });
}

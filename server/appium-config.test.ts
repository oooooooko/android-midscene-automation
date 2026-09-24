// Run: npx tsx --test server/appium-config.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AppConfig } from './config';

test('Appium autosave is isolated from manual config, persists and rejects invalid colors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'appium-config-check-'));
  const oldRoot = process.env.ANDROID_MIDSCENE_DATA_ROOT;
  process.env.ANDROID_MIDSCENE_DATA_ROOT = root;
  const { createApiMiddleware } = await import('./http-api');
  const handler = createApiMiddleware();
  const server = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end(); }));
  let releaseModel: (() => void) | undefined;
  let modelStarted: (() => void) | undefined;
  const modelServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader('Content-Type', 'application/json');
    if (body.model === 'fail') {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { message: 'invalid test key' } }));
      return;
    }
    if (body.model === 'slow') {
      await new Promise<void>(resolve => { releaseModel = resolve; modelStarted?.(); });
    }
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }] }));
  });
  try {
    await new Promise<void>(resolve => modelServer.listen(0, '127.0.0.1', resolve));
    const modelAddress = modelServer.address();
    assert.ok(modelAddress && typeof modelAddress === 'object');
    const model = { baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`, apiKey: 'test', name: 'pass', family: 'gpt-5' };
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const initial = await (await fetch(base + '/api/config')).json() as AppConfig;
    const appium = { ...initial.appium, flowLineColor: '#AbC', model: { baseUrl: 'https://example.invalid', apiKey: 'test', name: 'new-model' } };
    assert.equal((await post('/api/config/appium', { appium, runtime: { androidSdkPath: 'invalid-draft' }, midscene: { model: { name: 'unsaved' } } })).status, 200);
    let stored = await (await fetch(base + '/api/config')).json() as AppConfig;
    assert.equal(stored.appium.flowLineColor, '#aabbcc');
    assert.deepEqual(stored.runtime, initial.runtime);
    assert.deepEqual(stored.midscene, initial.midscene);
    const { appium: _appium, ...manual } = structuredClone(initial);
    manual.midscene.model.name = 'saved-midscene';
    assert.equal((await post('/api/config', manual)).status, 200);
    stored = await (await fetch(base + '/api/config')).json() as AppConfig;
    assert.deepEqual(stored.appium.model, initial.appium.model, 'automatic saves must not persist untested model drafts');
    assert.equal(stored.midscene.model.name, initial.midscene.model.name, 'runtime save must not persist an untested model');
    assert.equal((await post('/api/config/appium', { appium: { ...appium, flowLineColor: 'invalid' } })).status, 400);
    assert.equal((await post('/api/config/appium', { appium: null })).status, 400);
    const { loadModelConfigFromDb } = await import('./config-store');
    assert.equal(loadModelConfigFromDb()?.appium?.flowLineColor, '#aabbcc');

    for (const key of ['midscene', 'scriptOptimizer', 'appium'] as const) {
      const before = await (await fetch(base + '/api/config')).json() as AppConfig;
      const failed = await post('/api/test-model', { modelKey: key, model: { ...model, name: 'fail' }, save: true });
      assert.equal(failed.status, 500);
      assert.deepEqual(await (await fetch(base + '/api/config')).json(), before, 'failed test must leave all persisted config unchanged');
      const passed = await post('/api/test-model', { modelKey: key, model, save: true });
      assert.equal(passed.status, 200);
      assert.equal((await passed.json() as { saved: boolean }).saved, true);
      const after = await (await fetch(base + '/api/config')).json() as AppConfig;
      assert.equal(after[key].model.name, 'pass');
      for (const other of ['runtime', 'midscene', 'scriptOptimizer', 'appium'] as const) {
        if (other !== key) assert.deepEqual(after[other], before[other]);
      }
    }
    assert.equal((await post('/api/appium-recorder/prompts/optimize', {
      kind: 'aiRecognition', prompt: '检查有没有广告', condition: true,
    })).status, 500, 'prompt optimization requires its own tested model');
    const unavailableSummaryModel = await post('/api/appium-recorder/report-summary/check', {});
    assert.equal(unavailableSummaryModel.status, 200);
    const unavailableSummaryStatus = await unavailableSummaryModel.json() as { available: boolean; message?: string };
    assert.equal(unavailableSummaryStatus.available, false);
    assert.equal(unavailableSummaryStatus.message, '模型配置不完整');
    const promptOptimizerBefore = await (await fetch(base + '/api/config')).json() as AppConfig;
    assert.equal((await post('/api/test-model', { modelKey: 'promptOptimizer', model: { ...model, name: 'fail' }, save: true })).status, 500);
    assert.deepEqual(await (await fetch(base + '/api/config')).json(), promptOptimizerBefore);
    assert.equal((await post('/api/test-model', { modelKey: 'promptOptimizer', model, save: true })).status, 200);
    stored = await (await fetch(base + '/api/config')).json() as AppConfig;
    assert.equal(stored.appium.promptOptimizer?.model.name, 'pass');
    const optimizedRecognition = await post('/api/appium-recorder/prompts/optimize', {
      kind: 'aiRecognition', prompt: '检查有没有广告', condition: true,
    });
    assert.equal(optimizedRecognition.status, 200);
    assert.deepEqual(await optimizedRecognition.json(), { prompt: 'OK' });
    const optimizedSummary = await post('/api/appium-recorder/prompts/optimize', {
      kind: 'reportSummary', prompt: '总结出图时间',
    });
    assert.equal(optimizedSummary.status, 200);
    assert.deepEqual(await optimizedSummary.json(), { prompt: 'OK' });
    // Summary settings auto-save independently and reuse the prompt optimizer model.
    const summaryBefore = await (await fetch(base + '/api/config')).json() as AppConfig;
    assert.equal(summaryBefore.appium.reportSummary?.enabled, false);
    const customReportPreset = { name: '支付流程', prompt: '输出支付流程的步骤和结果' };
    assert.equal((await post('/api/config/appium', { appium: { reportSummary: {
      enabled: true, prompt: '输出用例表格', customPresets: [customReportPreset], model,
    } } })).status, 200);
    let summaryConfig = await (await fetch(base + '/api/config')).json() as AppConfig;
    assert.equal(summaryConfig.appium.reportSummary?.prompt, '输出用例表格');
    assert.deepEqual(summaryConfig.appium.reportSummary?.customPresets, [customReportPreset]);
    assert.equal('model' in summaryConfig.appium.reportSummary!, false);
    assert.equal(summaryConfig.appium.promptOptimizer?.model.name, 'pass');
    const summaryModelStatus = await post('/api/appium-recorder/report-summary/check', {});
    assert.equal(summaryModelStatus.status, 200);
    assert.deepEqual(await summaryModelStatus.json(), { enabled: true, available: true });
    await post('/api/config/appium', { appium: { reportSummary: { enabled: false, prompt: '恢复测试格式', customPresets: [customReportPreset], model: { name: 'stale' } } } });
    summaryConfig = await (await fetch(base + '/api/config')).json() as AppConfig;
    assert.equal('model' in summaryConfig.appium.reportSummary!, false);
    assert.deepEqual(summaryConfig.appium.reportSummary?.customPresets, [customReportPreset]);
    assert.equal(summaryConfig.appium.promptOptimizer?.model.name, 'pass');
    assert.deepEqual(summaryConfig.appium.model, summaryBefore.appium.model);
    assert.equal((await post('/api/config/appium', { appium: { reportSummary: { prompt: '' } } })).status, 400);
    // A slow test must not revert an appearance edit saved while it was running.
    const started = new Promise<void>(resolve => { modelStarted = resolve; });
    const slowTest = post('/api/test-model', { modelKey: 'appium', model: { ...model, name: 'slow' }, save: true });
    await started;
    assert.equal((await post('/api/config/appium', { appium: { flowLineColor: '#123456' } })).status, 200);
    releaseModel!();
    assert.equal((await slowTest).status, 200);
    // A stale automatic-save payload must also preserve the newly tested model.
    await post('/api/config/appium', { appium: { ...appium, flowLineColor: '#123456' } });
    await post('/api/config', { runtime: initial.runtime });
    stored = await (await fetch(base + '/api/config')).json() as AppConfig;
    assert.equal(stored.appium.model.name, 'slow');
    assert.equal(stored.appium.promptOptimizer?.model.name, 'pass');
    assert.equal(stored.midscene.model.name, 'pass');
    assert.equal(stored.appium.flowLineColor, '#123456');
    assert.equal(loadModelConfigFromDb()?.appium?.model?.name, 'slow');

    assert.equal(initial.appium.aiPromptPresets?.length, 4, 'older configurations receive default prompt presets');
    await post('/api/config/appium', { appium: { aiPromptPresets: ['旧提示词内容'] } });
    const migrated = await (await fetch(base + '/api/config')).json() as AppConfig;
    assert.deepEqual(migrated.appium.aiPromptPresets, [{ name: '自定义场景 1', prompt: '旧提示词内容' }]);
    const customPresets = [{ name: '广告检测', prompt: '当前画面是否出现广告？' }, { name: '标题提取', prompt: '请读取当前页面标题' }];
    assert.equal((await post('/api/config/appium', { appium: { aiPromptPresets: customPresets } })).status, 200);
    stored = await (await fetch(base + '/api/config')).json() as AppConfig;
    assert.deepEqual(stored.appium.aiPromptPresets, customPresets);
    assert.deepEqual(loadModelConfigFromDb()?.appium?.aiPromptPresets, customPresets);
    for (const invalid of [null, 'prompt', [''], ['x'.repeat(4001)]]) {
      assert.equal((await post('/api/config/appium', { appium: { aiPromptPresets: invalid } })).status, 400);
    }
    assert.deepEqual(loadModelConfigFromDb()?.appium?.aiPromptPresets, customPresets, 'invalid presets must not overwrite the saved list');
    await post('/api/config/appium', { appium: { aiPromptPresets: [] } });
    await post('/api/test-model', { modelKey: 'appium', model, save: true });
    stored = await (await fetch(base + '/api/config')).json() as AppConfig;
    assert.deepEqual(stored.appium.aiPromptPresets, [], 'deleting every preset must not restore defaults on subsequent saves');
    assert.deepEqual(loadModelConfigFromDb()?.appium?.aiPromptPresets, []);
  } finally {
    releaseModel?.();
    await new Promise<void>(resolve => modelServer.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (oldRoot === undefined) delete process.env.ANDROID_MIDSCENE_DATA_ROOT;
    else process.env.ANDROID_MIDSCENE_DATA_ROOT = oldRoot;
    await rm(root, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_REPORT_SUMMARY_PROMPT, resolveReportSummary } from '../../src/appium-recorder/report-summary';
import type { AppiumRecordedScriptRecord } from './repository';

test('summary is opt-in, uses logs and script parameters, preserves basic report on failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'report-summary-'));
  const previousRoot = process.env.ANDROID_MIDSCENE_DATA_ROOT;
  process.env.ANDROID_MIDSCENE_DATA_ROOT = root;
  const requests: any[] = [];
  let responseMode = 'ok';
  const server = createServer(async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    requests.push(JSON.parse(Buffer.concat(parts).toString()));
    res.setHeader('Content-Type', 'application/json');
    if (responseMode === 'error') { res.statusCode = 401; res.end(JSON.stringify({ error: { message: 'secret-test-key' } })); return; }
    res.end(JSON.stringify({ choices: [{ finish_reason: responseMode === 'truncated' ? 'length' : 'stop', message: {
      content: responseMode === 'empty' ? '' : '```markdown\n# 自定义总结\n测试成功。 secret-test-key sensitive-output\n```',
    } }] }));
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const config = resolveReportSummary({ enabled: true, prompt: '只输出测试概览和用例表格' });
    const reportSummaryModel = { baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'secret-test-key', name: 'shared-text-model' };
    const { createAppiumReplayReport } = await import('./report');
    const input = {
      script: { id: 'main', name: '测试主脚本', appPackage: 'test.app', appActivity: 'test.app/Main', steps: [{ id: 'node1', type: 'delay', label: '等待加载', timeoutMs: 2000, pageBefore: { treeSignature: 'large-tree' } }] } as AppiumRecordedScriptRecord,
      linkedScripts: [{ id: 'child', name: '连接的实时页', appPackage: 'test.app', appActivity: '', deviceId: 'test-device', createdAt: '', updatedAt: '', steps: [{ id: 'child1', type: 'aiRecognition', label: '检查出图', value: '有没有出图' }] }] as AppiumRecordedScriptRecord[],
      deviceId: 'test-device', success: true, startedAt: new Date('2026-09-23T00:00:00Z'), completedAt: new Date('2026-09-23T00:00:02Z'),
      output: '[节点 1] 开始：等待加载\n[节点 1] 成功：等待加载\nsecret-test-key', screenshotReport: false,
      redact: (value: string) => value.replaceAll('sensitive-output', '[REDACTED]'),
    };
    const disabled = await createAppiumReplayReport({ ...input, reportSummary: resolveReportSummary() });
    assert.equal(requests.length, 0);
    assert.match(await readFile(disabled.filePath, 'utf8'), /Appium 回放报告/);
    const missingModel = await createAppiumReplayReport({
      ...input,
      reportSummary: config,
      reportSummaryModel: { baseUrl: '', apiKey: '', name: '' },
    });
    assert.match(missingModel.summaryStatus, /提示词优化模型未配置/);
    assert.match(await readFile(missingModel.filePath, 'utf8'), /Appium 回放报告/);
    const report = await createAppiumReplayReport({ ...input, reportSummary: config, reportSummaryModel });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, 'shared-text-model');
    assert.equal(requests[0].messages[1].content, config.prompt);
    const context = requests[0].messages[2].content;
    assert.match(context, /连接的实时页/); assert.match(context, /timeoutMs/); assert.match(context, /"durationMs":2000/);
    assert.match(context, /节点 1/); assert.doesNotMatch(context, /secret-test-key|large-tree/);
    const text = await readFile(report.filePath, 'utf8');
    assert.match(text, /^# 自定义总结/); assert.doesNotMatch(text, /secret-test-key|sensitive-output|```/);
    assert.match(await readFile(report.logPath, 'utf8'), /回放报告总结已生成/);
    for (const mode of ['error', 'empty', 'truncated']) {
      responseMode = mode;
      const fallback = await createAppiumReplayReport({ ...input, success: false, reportSummary: config, reportSummaryModel });
      assert.match(fallback.summaryStatus, /失败，已保留基础报告/);
      assert.doesNotMatch(fallback.summaryStatus, /secret-test-key/);
      assert.match(await readFile(fallback.filePath, 'utf8'), /Appium 回放报告/);
      assert.match(await readFile(fallback.logPath, 'utf8'), /回放报告总结失败/);
    }
    assert.equal(resolveReportSummary().enabled, false);
    assert.equal(resolveReportSummary().prompt, DEFAULT_REPORT_SUMMARY_PROMPT);
    assert.deepEqual(resolveReportSummary({ customPresets: [{ name: '支付流程', prompt: '总结支付结果' }] }).customPresets,
      [{ name: '支付流程', prompt: '总结支付结果' }]);
    assert.throws(() => resolveReportSummary({ prompt: '' }), /不能为空/);
    assert.throws(() => resolveReportSummary({ customPresets: [{ name: '默认测试报告', prompt: '重复名称' }] }), /名称已存在/);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previousRoot === undefined) delete process.env.ANDROID_MIDSCENE_DATA_ROOT; else process.env.ANDROID_MIDSCENE_DATA_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

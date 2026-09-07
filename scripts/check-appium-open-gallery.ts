import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const root = await mkdtemp(join(tmpdir(), 'gallery-check-'));
const originalExec = childProcess.execFile;
const originalFetch = globalThis.fetch;
const env = { ...process.env };
let mode = 'default';
const calls: string[][] = [];
try {
  const sdk = join(root, 'sdk');
  await mkdir(join(sdk, 'platform-tools'), { recursive: true });
  await writeFile(join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'), '');
  Object.assign(process.env, { ANDROID_MIDSCENE_DATA_ROOT: root, ANDROID_SDK_ROOT: sdk, ANDROID_HOME: sdk, APPIUM_SERVER_URL: 'http://appium-test.invalid' });
  childProcess.execFile = ((command, args, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    calls.push(args);
    let output: string | Buffer = '';
    if (args.includes('android.intent.category.APP_GALLERY')) {
      output = mode === 'default' || mode === 'error' ? 'vendor.gallery/.Main'
        : mode === 'query' ? (args.includes('query-activities') ? 'vendor.gallery/.Main' : 'android/com.android.internal.app.ResolverActivity')
        : 'No activity found';
    } else if (args.includes('list') && args.includes('packages')) {
      output = mode === 'fallback' ? 'package:com.miui.gallery\npackage:unrelated.app' : '';
    } else if (args.includes('android.intent.category.LAUNCHER')) {
      assert.ok(args.includes('com.miui.gallery'));
      output = 'com.miui.gallery/.Home';
    } else if (args.includes('start') && args.includes('am')) {
      assert.ok(args.includes('-n'));
      assert.ok(!args.some((arg) => /GET_CONTENT|PICK/.test(arg)));
      output = mode === 'error' ? 'Error: Permission Denial' : 'Status: ok\nComplete';
    } else if (args.includes('screencap')) {
      output = PNG.sync.write(new PNG({ width: 2, height: 2 }));
    }
    queueMicrotask(() => done(options?.signal?.aborted ? new Error('aborted') : null, output, ''));
    return {};
  }) as typeof childProcess.execFile;
  syncBuiltinESMExports();
  const { openGalleryOnDevice } = await import('../server/appium-recorder/open-gallery');
  for (mode of ['default', 'query', 'fallback']) {
    calls.length = 0;
    assert.match(await openGalleryOnDevice('test'), /已启动相册/);
    assert.equal(calls.filter((args) => args.includes('start')).length, 1);
  }
  mode = 'none';
  await assert.rejects(openGalleryOnDevice('test'), /未找到/);
  mode = 'error';
  await assert.rejects(openGalleryOnDevice('test'), /启动相册失败/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(openGalleryOnDevice('test', controller.signal), /aborted/);
  mode = 'default';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.host, 'appium-test.invalid');
    return Response.json({ value: url.pathname === '/session' ? { sessionId: 'test-session' } : null });
  };
  const { replayAppiumScript } = await import('../server/appium-recorder/appium-runner');
  const result = await replayAppiumScript({
    id: 'test', name: '启动相册测试', appPackage: 'example.app', appActivity: '', deviceId: 'test', createdAt: '', updatedAt: '',
    steps: [{ id: 'gallery', type: 'openGallery', label: '启动相册' }, { id: 'next', type: 'log', label: '继续', value: 'after gallery' }],
  }, 'test');
  assert.equal(result.success, true);
  assert.ok(result.output.includes('已启动相册：vendor.gallery/.Main'));
  assert.ok(result.output.includes('stageLog:after gallery'));
  assert.ok((await readFile(result.htmlReportPath!, 'utf8')).includes('启动相册'));
  console.log('PASS: gallery resolution, chooser avoidance, installed fallback, missing/error/abort, sequential replay and report');
  const { saveAppiumRecordedScript } = await import('../server/appium-recorder/repository');
  const base = { name: '终止测试', appPackage: 'example.app', appActivity: '', deviceId: 'test', createdAt: '', updatedAt: '' };
  const end = { id: 'end', type: 'endFlow' as const, label: '终止流程' };
  const next = { id: 'next', type: 'log' as const, label: '不应执行', value: 'UNREACHABLE' };
  const child = saveAppiumRecordedScript({ ...base, steps: [end, next] });
  const link = { id: 'link', type: 'runScript' as const, label: '连接子脚本', value: child.id };
  const cases = [
    [end, next, link],
    [{ ...end, flow: { nodeKind: 'action' as const, successTargetId: 'next' } }, next, link],
    [link, next, { ...link, id: 'trailing' }],
    [link, { ...link, id: 'trailing' }],
    [
      { id: 'condition', type: 'assertExists' as const, label: '判断', selector: { strategy: 'id' as const, value: 'missing' }, timeoutMs: 1,
        flow: { nodeKind: 'condition' as const, yesTargetId: 'next', noTargetId: 'end' } },
      { ...end, flow: { nodeKind: 'action' as const, parentConditionId: 'condition', parentBranch: 'no' as const, successTargetId: 'next' } },
      next,
    ],
  ];
  for (const steps of cases) {
    const ended = await replayAppiumScript({ ...base, id: 'parent', steps }, 'test');
    assert.equal(ended.success, true, ended.output);
    assert.ok(ended.output.includes('流程已主动结束'));
    assert.ok(!ended.output.includes('UNREACHABLE'));
    assert.equal((ended.output.match(/开始：终止流程/g) || []).length, 1);
    assert.ok((await readFile(ended.htmlReportPath!, 'utf8')).includes('流程已结束'));
  }
  const fresh = await replayAppiumScript({ ...base, id: 'fresh', steps: [next] }, 'test');
  assert.equal(fresh.success, true);
  assert.ok(fresh.output.includes('UNREACHABLE'));
  console.log('PASS: end flow in linear/graph/branch/linked scripts, trailing links skipped, report and next-run isolation');
} finally {
  childProcess.execFile = originalExec;
  syncBuiltinESMExports();
  globalThis.fetch = originalFetch;
  process.env = env;
  await rm(root, { recursive: true, force: true });
}

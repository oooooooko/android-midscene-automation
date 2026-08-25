import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataRoot = await mkdtemp(join(tmpdir(), 'appium-replay-check-'));
let elementRequestReceived = false;
let pendingElementResponse: ServerResponse | null = null;
let pendingDeleteResponse: ServerResponse | null = null;
const server = createServer((req, res) => {
  req.resume();
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST' && req.url === '/session') {
    res.end(JSON.stringify({ value: { sessionId: 'check-session' } }));
    return;
  }
  if (req.method === 'GET' && req.url === '/session/check-session/screenshot') {
    res.end(JSON.stringify({
      value: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    }));
    return;
  }
  if (req.method === 'POST' && req.url === '/session/check-session/element') {
    elementRequestReceived = true;
    pendingElementResponse = res;
    return;
  }
  if (req.method === 'DELETE' && req.url === '/session/check-session') {
    pendingDeleteResponse = res;
    return;
  }
  res.end(JSON.stringify({ value: null }));
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
process.env.APPIUM_SERVER_URL = `http://127.0.0.1:${address.port}`;
process.env.ANDROID_MIDSCENE_DATA_ROOT = dataRoot;

try {
  const { replayAppiumScript } = await import('../server/appium-recorder/appium-runner');
  const controller = new AbortController();
  const startedAt = Date.now();
  const result = await replayAppiumScript({
    id: 'check-script',
    name: '终止回放检查',
    appPackage: 'com.example.check',
    appActivity: '',
    deviceId: 'check-device',
    steps: [{
      id: 'assert-exists',
      type: 'assertExists',
      label: '等待目标元素出现',
      selector: { strategy: 'id', value: 'com.example.check:id/missing' },
      timeoutMs: 30_000,
    }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, 'check-device', (line) => {
    if (line.includes('[节点 1] 开始')) setTimeout(() => controller.abort(), 100);
  }, controller.signal);

  assert(elementRequestReceived);
  assert(Date.now() - startedAt < 5000, '终止等待元素后应在 5 秒内释放回放状态');
  assert.equal(result.success, false);
  assert.equal(result.stopped, true);
  assert(result.reportPath);
  assert(result.logPath);
  assert(result.htmlReportPath);
  const [report, log, html] = await Promise.all([
    readFile(result.reportPath, 'utf8'),
    readFile(result.logPath, 'utf8'),
    readFile(result.htmlReportPath, 'utf8'),
  ]);
  assert.match(report, /执行结果 \| \*\*已终止\*\*/);
  assert.match(log, /\[Appium\] 请求：POST \/session/);
  assert.match(log, /回放已终止：用户手动终止/);
  assert.match(html, /Appium 截图回放/);
  assert.match(html, /data:image\/png;base64/);
  assert.match(html, /已终止/);
  assert.match(html, /回放时间轴/);
  assert.match(html, /完整回放日志/);
  assert.match(html, /requestAnimationFrame/);
  assert.doesNotMatch(html, /<details open/);
  assert.equal((html.match(/data:image\/png;base64/g) || []).length, 2);
  const runnableScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert(runnableScripts.length > 0);
  new Function(runnableScripts.at(-1)?.[1] || '');
  console.log('Appium 回放终止、报告、日志和截图回放检查通过');
} finally {
  pendingElementResponse?.destroy();
  pendingDeleteResponse?.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dataRoot, { recursive: true, force: true });
}

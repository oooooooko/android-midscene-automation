import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataRoot = await mkdtemp(join(tmpdir(), 'appium-session-check-'));
let sessionRequest: Record<string, unknown> | null = null;
const screenshot = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/session') {
      sessionRequest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.end(JSON.stringify({ value: { sessionId: 'check-session' } }));
      return;
    }
    if (req.method === 'GET' && req.url === '/session/check-session/screenshot') {
      res.end(JSON.stringify({ value: screenshot }));
      return;
    }
    res.end(JSON.stringify({ value: null }));
  });
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
process.env.APPIUM_SERVER_URL = `http://127.0.0.1:${address.port}`;
process.env.ANDROID_MIDSCENE_DATA_ROOT = dataRoot;

try {
  const [{ importAppiumRecordedScript }, { replayAppiumScript }] = await Promise.all([
    import('../server/appium-recorder/repository'),
    import('../server/appium-recorder/appium-runner'),
  ]);
  const imported = importAppiumRecordedScript({
    name: '登录 APP',
    appPackage: 'com.example.app',
    appActivity: 'com.vendor.launcher/.Launcher',
    steps: [{
      id: 'input',
      type: 'input',
      label: '输入账号',
      pageBefore: { activity: 'com.example.app/com.example.LoginActivity' },
    }],
  });
  assert.equal(imported?.appActivity, 'com.example.app/com.example.LoginActivity');

  await replayAppiumScript({
    id: 'session-check',
    name: 'Session 启动参数检查',
    appPackage: 'com.example.app',
    appActivity: 'com.vendor.launcher/.Launcher',
    deviceId: 'check-device',
    steps: [{ id: 'delay', type: 'delay', label: '短延时', timeoutMs: 1 }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, 'check-device');

  const capabilities = (sessionRequest as {
    capabilities?: { alwaysMatch?: Record<string, unknown> };
  } | null)?.capabilities?.alwaysMatch;
  assert(capabilities);
  assert.equal(capabilities['appium:autoLaunch'], false);
  assert.equal('appium:appPackage' in capabilities, false);
  assert.equal('appium:appActivity' in capabilities, false);
  console.log('Appium session 与应用启动解耦检查通过');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dataRoot, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('batch import remaps linked script ids and keeps imported names unique', async () => {
  const root = await mkdtemp(join(tmpdir(), 'appium-script-import-'));
  const previousRoot = process.env.ANDROID_MIDSCENE_DATA_ROOT;
  process.env.ANDROID_MIDSCENE_DATA_ROOT = root;
  try {
    const { importAppiumRecordedScripts } = await import('./repository');
    const scripts = importAppiumRecordedScripts([
      {
        sourceId: 'exported-root',
        name: '回归测试',
        appPackage: 'test.app',
        steps: [{ id: 'link', type: 'runScript', label: '连接脚本 子流程', value: 'exported-child' }],
      },
      {
        sourceId: 'exported-child',
        name: '子流程',
        appPackage: 'test.app',
        steps: [{ id: 'delay', type: 'delay', label: '等待', timeoutMs: 100 }],
      },
    ]);

    assert.equal(scripts.length, 2);
    assert.notEqual(scripts[0].id, 'exported-root');
    assert.notEqual(scripts[1].id, 'exported-child');
    assert.equal(scripts[0].steps[0].value, scripts[1].id);

    const duplicate = importAppiumRecordedScripts([{
      sourceId: 'another-child',
      name: '子流程',
      appPackage: 'test.app',
      steps: [],
    }])[0];
    assert.equal(duplicate.name, '子流程 (2)');
  } finally {
    if (previousRoot === undefined) delete process.env.ANDROID_MIDSCENE_DATA_ROOT;
    else process.env.ANDROID_MIDSCENE_DATA_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

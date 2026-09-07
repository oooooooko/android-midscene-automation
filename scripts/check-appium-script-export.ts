import assert from 'node:assert/strict';
import { buffer } from 'node:stream/consumers';
import { fromBuffer } from 'yauzl';
import { createAppiumScriptExport } from '../server/appium-recorder/script-export';
import type { AppiumRecordedScriptRecord } from '../server/appium-recorder/repository';

function script(id: string, targets: string[] = [], name = id): AppiumRecordedScriptRecord {
  return {
    id, name, appPackage: 'example.app', appActivity: '.MainActivity', deviceId: '',
    createdAt: '', updatedAt: '',
    steps: targets.map((value, index) => ({ id: `${id}-${index}`, type: 'runScript', label: `Link ${value}`, value })),
  };
}

function exportScript(scripts: AppiumRecordedScriptRecord[]) {
  const byId = new Map(scripts.map((item) => [item.id, item]));
  return createAppiumScriptExport(scripts[0], (id) => byId.get(id) || null);
}

function readArchive(data: Buffer) {
  return new Promise<Map<string, { schemaVersion: number; script: AppiumRecordedScriptRecord }>>((resolve, reject) => {
    fromBuffer(data, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const files = new Map();
      zip.on('error', reject);
      zip.on('end', () => resolve(files));
      zip.on('entry', (entry) => {
        zip.openReadStream(entry, (error, stream) => {
          if (error) return reject(error);
          buffer(stream).then((content) => {
            assert.ok(!files.has(entry.fileName), 'Archive entries must not overwrite one another');
            files.set(entry.fileName, JSON.parse(content.toString('utf8')));
            zip.readEntry();
          }).catch(reject);
        });
      });
      zip.readEntry();
    });
  });
}

const alone = script('single', [], '单个脚本');
alone.steps.push({ id: 'input', type: 'input', label: 'Input', value: 'not-a-script-id' });
const single = await exportScript([alone]);
assert.equal(single.fileName, '单个脚本.json');
assert.equal(single.contentType, 'application/json; charset=utf-8');
assert.deepEqual(JSON.parse(single.body.toString()).script.steps, alone.steps);

const chain = [script('A', ['B']), script('B', ['C']), script('C'), script('unrelated')];
const original = JSON.stringify(chain);
const result = await exportScript(chain);
assert.equal(result.fileName, 'A.zip');
assert.equal(result.contentType, 'application/zip');
const files = await readArchive(result.body);
assert.deepEqual([...files.keys()].sort(), ['A.json', 'B.json', 'C.json']);
for (const item of chain.slice(0, 3)) {
  const exported = files.get(`${item.name}.json`)!;
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.script.id, item.id);
  assert.deepEqual(exported.script.steps, item.steps, 'All nodes and linked script IDs must be preserved');
}
assert.equal(JSON.stringify(chain), original, 'Export must not mutate stored scripts');

// Include both sides of a condition, deduplicate shared dependencies and stop cycles.
const branched = [script('A', ['B', 'C', 'B']), script('B', ['D']), script('C', ['D']), script('D', ['A'])];
branched[0].steps[0].flow = { parentConditionId: 'condition', parentBranch: 'yes' };
branched[0].steps[1].flow = { parentConditionId: 'condition', parentBranch: 'no' };
assert.deepEqual(
  [...(await readArchive((await exportScript(branched)).body)).keys()].sort(),
  ['A.json', 'B.json', 'C.json', 'D.json'],
);
assert.deepEqual([...(await readArchive((await exportScript([script('A', ['A'])])).body)).keys()], ['A.json']);

const unusualNames = [
  script('root', ['slash', 'backslash', 'uppercase', 'reserved', 'empty'], '登录 APP'),
  script('slash', [], '../a'),
  script('backslash', [], '..\\a'),
  script('uppercase', [], '../A'),
  script('reserved', [], 'CON'),
  script('empty', [], '...'),
];
const namedFiles = await readArchive((await exportScript(unusualNames)).body);
assert.equal(namedFiles.size, unusualNames.length);
assert.equal(new Set([...namedFiles.keys()].map((name) => name.toLowerCase())).size, unusualNames.length);
assert.ok(namedFiles.has('登录 APP.json'));
for (const name of namedFiles.keys()) assert.ok(!/[<>:"/\\|?*\u0000-\u001f]/.test(name), `Unsafe file name: ${name}`);
assert.deepEqual(
  [...namedFiles.values()].map((entry) => entry.script.name).sort(),
  unusualNames.map((item) => item.name).sort(),
  'File name sanitization must preserve the original script names inside JSON',
);

await assert.rejects(exportScript([script('A', ['missing'])]), /连接的脚本不存在/);
await assert.rejects(exportScript([script('A', ['B']), script('B', ['missing'])]), /脚本「B」连接的脚本不存在/);
await assert.rejects(exportScript([script('A', [''])]), /缺少连接脚本 ID/);

console.log('Appium script export checks passed (JSON, recursive ZIP, branches, cycles, file names, missing links)');

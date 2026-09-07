import assert from 'node:assert/strict';
import { readFreshWindowHierarchy } from '../server/appium-recorder/tree-dump';

const files = new Map([['/data/local/tmp/midscene_appium_uidump.xml', '<hierarchy>old</hierarchy>']]);
const paths: string[] = [];
let mode = 'success';
const exec = async (_command: string, args: string[]) => {
  assert.equal(args[1], 'test');
  const file = args.at(-1)!;
  if (args.includes('dump')) {
    paths.push(file);
    if (mode === 'reported-error') return 'ERROR: could not get idle state.';
    if (mode === 'success') files.set(file, '<hierarchy><node text="new" /></hierarchy>');
    if (mode === 'invalid') files.set(file, 'not XML');
    return '';
  }
  if (args.includes('cat')) {
    if (!files.has(file)) throw new Error('No such file');
    return files.get(file)!;
  }
  assert.ok(args.includes('rm'));
  files.delete(file);
  return '';
};

assert.match(await readFreshWindowHierarchy('test', 'adb', exec), /text="new"/);
assert.match(await readFreshWindowHierarchy('test', 'adb', exec), /text="new"/);
assert.notEqual(paths[0], paths[1]);
for (mode of ['reported-error', 'silent-error', 'invalid']) {
  await assert.rejects(readFreshWindowHierarchy('test', 'adb', exec), /刷新组件树失败/);
  assert.ok(!files.has(paths.at(-1)!));
}
assert.equal(files.size, 1, 'Only unrelated legacy file remains');
console.log('PASS: fresh tree, unique paths, zero-exit failures, invalid output, cleanup');

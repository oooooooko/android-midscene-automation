import { resolveReportSummary } from '../src/appium-recorder/report-summary';
// Run: npx tsx --test server/appium-auto-save.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { effectScope, reactive } from 'vue';
import { useAppiumAutoSave } from '../src/config/use-appium-auto-save';
import type { ConfigForm } from '../src/types';

test('loads quietly, serializes rapid edits, validates colors and surfaces save errors', async () => {
  const scope = effectScope();
  const form = reactive({ appium: { reportSummary: resolveReportSummary(), model: { baseUrl: '', apiKey: '', name: '' } } } as ConfigForm);
  const submissions: Omit<ConfigForm['appium'], 'model'>[] = [];
  const errors: unknown[] = [];
  let release: (() => void) | undefined;
  let fail = false;
  const auto = scope.run(() => useAppiumAutoSave(form, async value => {
    submissions.push(value);
    if (fail) throw new Error('offline');
    if (submissions.length === 1) await new Promise<void>(resolve => { release = resolve; });
  }, error => errors.push(error)))!;
  try {
    form.appium.model.name = 'loaded';
    auto.initialize();
    await delay(400);
    assert.equal(submissions.length, 0, 'loading must never overwrite stored config');
    form.appium.model.name = 'untested';
    await delay(400);
    assert.equal(submissions.length, 0, 'model drafts must never auto-save');
    form.appium.flowBackgroundColor = '#abc';
    form.appium.flowBackgroundColor = '#def';
    await delay(400);
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].flowBackgroundColor, '#def');
    assert.equal('model' in submissions[0], false);
    form.appium.flowBackgroundColor = '#123456';
    await delay(400);
    assert.equal(submissions.length, 1, 'only one request may be in flight');
    release!();
    await delay(20);
    assert.equal(submissions.length, 2);
    assert.equal(submissions[1].flowBackgroundColor, '#123456');
    assert.equal(auto.status.value, '已自动保存');
    form.appium.flowLineColor = '#';
    await delay(400);
    assert.equal(submissions.length, 2, 'partial hex input must not be persisted');
    form.appium.flowLineColor = '#123';
    await delay(400);
    assert.equal(submissions.length, 3);
    fail = true;
    form.appium.screenshotReport = true;
    await delay(400);
    assert.equal(errors.length, 1);
    assert.match(auto.status.value, /失败/);
    assert.equal(auto.failed.value, true);
    assert.equal(auto.dirty.value, true);
    fail = false;
    await auto.retry();
    assert.equal(auto.failed.value, false);
    assert.equal(auto.dirty.value, false);
    assert.equal(submissions.at(-1)?.screenshotReport, true);
    form.appium.flowBackgroundColor = '#abcdef';
    await delay(400);
    assert.equal(auto.status.value, '已自动保存');
    assert.equal(submissions.at(-1)?.screenshotReport, true);
  } finally { scope.stop(); }
});

import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.route('**/__merge-test', (route) => route.fulfill({ contentType: 'text/html', body: '<div id="app" style="max-width:1200px;margin:auto"></div>' }));
  await page.route('**/api/**', (route) => route.abort());
  await page.goto(`${process.env.APP_URL || 'http://127.0.0.1:5173'}/__merge-test`);
  await page.evaluate(async () => {
    const source = await (await fetch('/src/main.ts')).text();
    const { createApp, h, reactive } = await import(source.match(/"([^"\n]*\/vue\.js\?v=[^"]+)"/)[1]);
    const ElementPlus = (await import(source.match(/"([^"\n]*\/element-plus\.js\?v=[^"]+)"/)[1])).default;
    for (const path of ['/node_modules/element-plus/dist/index.css', '/node_modules/@vue-flow/core/dist/style.css', '/node_modules/@vue-flow/core/dist/theme-default.css', '/src/style.css', '/src/ui-refresh.css']) await import(path);
    const RecordedSteps = (await import('/src/appium-recorder/components/RecordedSteps.vue')).default;
    const { removeFlowStep } = await import('/src/appium-recorder/flow-remove.ts');
    const state = reactive({ disabled: true, mergeDisabled: false, steps: [
      { id: 'c', type: 'checkedState', label: '判断勾选', flow: { nodeKind: 'condition', yesTargetId: 'a', noTargetId: 'duplicate' } },
      { id: 'a', type: 'log', label: '独有操作', value: 'left', flow: { parentConditionId: 'c', parentBranch: 'yes' } },
      { id: 'common', type: 'log', label: '公共操作', value: 'shared', flow: { parentConditionId: 'c', parentBranch: 'yes' } },
      { id: 'last', type: 'log', label: '公共后续', value: 'last', flow: { parentConditionId: 'c', parentBranch: 'yes' } },
      { id: 'duplicate', type: 'log', label: '重复操作', value: 'shared', flow: { parentConditionId: 'c', parentBranch: 'no' } },
    ] });
    window.mergeTest = state;
    window.mergeOriginal = JSON.parse(JSON.stringify(state.steps));
    createApp({ render: () => h(RecordedSteps, { ...state, onReplaceSteps: (steps) => { state.steps = steps; }, onRemove: (index) => { state.steps = removeFlowStep(state.steps, index); } }) }).use(ElementPlus).mount('#app');
  });
  await page.getByRole('button', { name: '放大', exact: true }).click();
  const overview = page.getByRole('dialog', { name: '流程总览' });
  await page.evaluate(() => { window.mergeTest.mergeDisabled = true; });
  await expect(overview.getByRole('button', { name: '合并分支', exact: true })).toBeDisabled();
  await page.evaluate(() => { window.mergeTest.mergeDisabled = false; });
  await expect(overview.getByRole('button', { name: '合并分支', exact: true })).toBeEnabled();
  await overview.getByRole('button', { name: '合并分支', exact: true }).hover();
  await expect(page.getByRole('tooltip').filter({ hasText: '合并分支：将两侧后续节点汇入公共流程' })).toBeVisible();
  await overview.getByRole('button', { name: '合并分支', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '合并分支', exact: true });
  await dialog.locator('.el-select__wrapper').nth(0).click();
  await page.getByRole('option', { name: 'true · 公共操作', exact: true }).click();
  await dialog.locator('.el-select__wrapper').nth(1).click();
  await page.getByRole('option', { name: '重复操作', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '合并分支' })).toBeDisabled();
  await dialog.locator('.el-checkbox').click();
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  await dialog.getByRole('button', { name: '合并分支' }).click();
  await expect(dialog).toBeHidden();
  await expect(overview.locator('.appium-flow-step-card')).toHaveCount(4);
  await overview.getByRole('button', { name: 'Close this dialog' }).click();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await page.waitForTimeout(500);
  const card = (text) => overview.locator('.appium-flow-step-card').filter({ hasText: text });
  const parent = await card('判断勾选').boundingBox();
  const common = await card('公共操作').boundingBox();
  const left = await card('独有操作').boundingBox();
  assert.ok(Math.abs(parent.x + parent.width / 2 - common.x - common.width / 2) < 2);
  assert.ok(common.y > left.y + left.height);
  const joinLines = await overview.locator('.vue-flow__edge[data-id*="step:common:"]:not([data-id^="e:step:common:"]) .vue-flow__edge-path').evaluateAll((paths) =>
    paths.map((path) => (path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g) || []).map(Number)));
  assert.equal(joinLines.length, 2);
  assert.equal(joinLines[0][3], joinLines[1][3], 'Both incoming horizontal segments share one Y coordinate');
  for (const points of joinLines) {
    assert.equal(points[3], points[5]);
    assert.equal(points[7] - points[3], 24, 'Join height depends only on the common target');
  }
  await page.screenshot({ path: '/tmp/midscene-flow-merge.png', animations: 'disabled' });
  await card('独有操作').locator('..').getByTitle('删除节点').click();
  await expect(overview.locator('.appium-flow-step-card')).toHaveCount(3);
  await expect(card('公共操作')).toBeVisible();
  await overview.getByRole('button', { name: 'Close this dialog' }).click();
  await expect(page.locator('#app .appium-flow-step-card')).toHaveCount(3);
  // 镜像方向：公共部分保留右侧，左侧只留下独有操作。
  await page.evaluate(() => { window.mergeTest.steps = JSON.parse(JSON.stringify(window.mergeOriginal)); });
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await overview.getByRole('button', { name: '合并分支', exact: true }).click();
  await dialog.getByText('保留右侧流程', { exact: true }).click();
  await dialog.locator('.el-select__wrapper').nth(0).click();
  await expect(page.getByRole('option', { name: 'true · 公共操作', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'false · 重复操作', exact: true }).click();
  await dialog.locator('.el-select__wrapper').nth(1).click();
  await page.getByRole('option', { name: '公共操作', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '合并分支' })).toBeDisabled();
  await dialog.locator('.el-checkbox').click();
  await dialog.getByRole('button', { name: '合并分支' }).click();
  await expect(dialog).toBeHidden();
  const reversed = await page.evaluate(() => window.mergeTest.steps);
  assert.deepEqual(reversed.map((step) => step.id), ['c', 'a', 'duplicate']);
  assert.equal(reversed[0].flow.noTargetId, 'duplicate');
  assert.equal(reversed[1].flow.successTargetId, 'duplicate');
  assert.equal(reversed[2].flow.parentConditionId, undefined);
  assert.deepEqual(errors, []);
  console.log('PASS: merge dialog, explicit deletion confirmation, centered shared flow, expanded/main synchronization and branch deletion');
} finally { await browser.close(); }

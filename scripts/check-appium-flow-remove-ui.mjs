import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.route('**/__remove-check', (route) => route.fulfill({ contentType: 'text/html', body: '<div id="app" style="margin:24px auto;max-width:1200px"></div>' }));
  await page.route('**/api/**', (route) => route.abort());
  await page.goto(`${process.env.APP_URL || 'http://127.0.0.1:5173'}/__remove-check`);
  await page.evaluate(async () => {
    const source = await (await fetch('/src/main.ts')).text();
    const { createApp, h, reactive } = await import(source.match(/"([^"\n]*\/vue\.js\?v=[^"]+)"/)[1]);
    const ElementPlus = (await import(source.match(/"([^"\n]*\/element-plus\.js\?v=[^"]+)"/)[1])).default;
    for (const path of ['/node_modules/element-plus/dist/index.css', '/node_modules/@vue-flow/core/dist/style.css', '/node_modules/@vue-flow/core/dist/theme-default.css', '/src/style.css', '/src/ui-refresh.css']) await import(path);
    const RecordedSteps = (await import('/src/appium-recorder/components/RecordedSteps.vue')).default;
    const { removeFlowStep } = await import('/src/appium-recorder/flow-remove.ts');
    const fixture = [
      { id: 'outer', type: 'assertExists', label: '上一级判断', flow: { nodeKind: 'condition', yesTargetId: 'inner', noTargetId: 'other' } },
      { id: 'inner', type: 'assertExists', label: '待删除判断', flow: { nodeKind: 'condition', parentConditionId: 'outer', parentBranch: 'yes', yesTargetId: 'input', noTargetId: 'wait' } },
      { id: 'input', type: 'input', label: '子节点输入', flow: { parentConditionId: 'inner', parentBranch: 'yes' } },
      { id: 'wait', type: 'waitFor', label: '子节点等待', flow: { parentConditionId: 'inner', parentBranch: 'no' } },
      { id: 'other', type: 'noop', label: '保留的另一分支', flow: { parentConditionId: 'outer', parentBranch: 'no' } },
    ];
    const state = reactive({ steps: fixture });
    window.removeTest = { state, reset: () => { state.steps = fixture; } };
    createApp({ render: () => h(RecordedSteps, { steps: state.steps, onRemove: (index) => { state.steps = removeFlowStep(state.steps, index); } }) }).use(ElementPlus).mount('#app');
  });
  const main = page.locator('#app');
  async function remove(scope) {
    await expect(scope.locator('.appium-flow-step-card')).toHaveCount(5);
    await scope.locator('.appium-flow-step-shell').filter({ hasText: '待删除判断' }).getByRole('button', { name: '删除节点', exact: true }).click();
    await expect(scope.locator('.appium-flow-step-card')).toHaveCount(2);
    await expect(scope.locator('.appium-flow-step-card strong')).toHaveText(['上一级判断', '保留的另一分支']);
    const steps = await page.evaluate(() => window.removeTest.state.steps);
    assert.deepEqual(steps.map((step) => step.id), ['outer', 'other']);
    assert.equal(steps[0].flow.yesTargetId, undefined);
    assert.equal(steps[1].flow.parentBranch, 'no');
  }
  await remove(main);
  await page.evaluate(() => window.removeTest.reset());
  await main.getByRole('button', { name: '放大', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '流程总览' });
  await remove(dialog);
  await expect(main.locator('.appium-flow-step-card')).toHaveCount(2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/midscene-condition-deleted.png', animations: 'disabled' });
  assert.deepEqual(errors, []);
  console.log('PASS: nested condition deletion cascades in both normal and expanded canvases, preserving sibling branches');
} finally { await browser.close(); }

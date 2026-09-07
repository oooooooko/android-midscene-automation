import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

// Run against a local Vite server; mount the real editor without device or persistence APIs.
const baseURL = process.env.APP_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

try {
  await page.route('**/__action-menu-check', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<div id="app" style="max-width:900px;margin:24px auto"></div>',
  }));
  await page.route('**/api/**', (route) => route.abort());
  await page.goto(`${baseURL}/__action-menu-check`);
  await page.evaluate(async () => {
    // Resolve the same prebundled Vue instance that the SFC imports use.
    const source = await (await fetch('/src/main.ts')).text();
    const { createApp, h, reactive } = await import(source.match(/"([^"\n]*\/vue\.js\?v=[^"]+)"/)[1]);
    const ElementPlus = (await import(source.match(/"([^"\n]*\/element-plus\.js\?v=[^"]+)"/)[1])).default;
    for (const path of [
      '/node_modules/element-plus/dist/index.css',
      '/node_modules/@vue-flow/core/dist/style.css',
      '/node_modules/@vue-flow/core/dist/theme-default.css',
      '/src/style.css', '/src/ui-refresh.css',
    ]) await import(path);
    const path = '/src/appium-recorder/components/RecordedSteps.vue';
    const RecordedSteps = (await import(path)).default;
    const state = reactive({ steps: [], clipboardCount: 2, disabled: false, allowedLockedActions: [] });
    const events = [];
    Object.assign(window, { menuTest: { state, events } });
    createApp({ render: () => h(RecordedSteps, {
      ...state,
      onInsertAction: (...args) => events.push(['insert', ...args]),
      onInsertBranchAction: (...args) => events.push(['branch', ...args]),
      onPaste: (...args) => events.push(['paste', ...args]),
    }) }).use(ElementPlus).mount('#app');
  });

  const main = page.locator('#app');
  const menu = page.locator('.appium-action-menu:visible');
  const submenu = page.locator('.appium-action-submenu.el-popper:visible');
  const start = main.getByRole('button', { name: '在开始后插入操作', exact: true });
  const events = () => page.evaluate(() => window.menuTest.events);
  const patchState = (patch) => page.evaluate((value) => {
    Object.assign(window.menuTest.state, value);
  }, patch);
  async function open(trigger = start) {
    await trigger.click();
    await expect(menu.getByRole('menubar')).toHaveCount(1);
    await expect(menu.locator('.el-sub-menu__title')).toHaveText(['组件操作', '设备操作', '等待断言', '流程控制']);
    assert.ok((await menu.boundingBox()).height < 200, 'Root menu must fit its categories and optional paste action');
    const arrowOffsets = await menu.locator('.el-sub-menu__title').evaluateAll((titles) => titles.map((title) => {
      const row = title.getBoundingClientRect();
      const arrow = title.querySelector('.el-sub-menu__icon-arrow').getBoundingClientRect();
      return Math.abs(arrow.y + arrow.height / 2 - row.y - row.height / 2);
    }));
    assert.ok(arrowOffsets.every((offset) => offset <= 0.5), `Menu arrows must be vertically centered: ${arrowOffsets}`);
  }
  async function choose(group, label) {
    await menu.getByRole('menuitem', { name: group, exact: true }).hover();
    await menu.getByRole('menuitem', { name: label, exact: true }).click();
    await expect(menu).toHaveCount(0);
  }

  await open();
  await choose('组件操作', '长按');
  await open();
  await choose('组件操作', '长按');
  assert.deepEqual(await events(), [['insert', -1, 'longPress'], ['insert', -1, 'longPress']]);

  await open();
  const paste = menu.getByRole('menuitem', { name: '粘贴 2 个节点', exact: true });
  await expect(paste).toBeVisible();
  assert.equal(await paste.evaluate((item) => item.closest('.el-sub-menu')), null);
  await expect(paste).toHaveCSS('font-size', '12px');
  await expect(paste).toHaveCSS('font-weight', '700');
  await page.screenshot({ path: '/tmp/midscene-paste-menu.png', animations: 'disabled' });
  await paste.click();
  await expect(menu).toHaveCount(0);
  assert.deepEqual((await events()).at(-1), ['paste', -1, undefined]);
  await patchState({ clipboardCount: 0 });
  await open();
  await menu.getByRole('menuitem', { name: '流程控制', exact: true }).hover();
  await expect(submenu).toHaveCount(1);
  await expect(menu.getByRole('menuitem', { name: /粘贴/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(start).toBeFocused();

  await patchState({ disabled: true, allowedLockedActions: ['noop'] });
  await open();
  await menu.getByRole('menuitem', { name: '组件操作', exact: true }).hover();
  const disabled = menu.getByRole('menuitem', { name: '长按', exact: true });
  await expect(disabled).toHaveClass(/is-disabled/);
  await disabled.click();
  assert.equal((await events()).length, 3);
  await menu.getByRole('menuitem', { name: '设备操作', exact: true }).hover();
  await expect(menu.getByRole('menuitem', { name: '系统返回', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '空节点', exact: true })).toHaveCount(0);
  await choose('流程控制', '空节点');
  assert.deepEqual((await events()).at(-1), ['insert', -1, 'noop']);
  await patchState({ allowedLockedActions: [] });
  await expect(start).toBeDisabled();
  await patchState({ disabled: false, steps: [
    { id: 'condition', type: 'popupCondition', label: '判断存在', flow: { nodeKind: 'condition' } },
  ] });
  await main.getByRole('button', { name: '还原位置', exact: true }).click();

  for (const [label, branch] of [['是', 'yes'], ['否', 'no']]) {
    const trigger = main.getByRole('button', { name: `在“${label}”分支插入操作`, exact: true });
    await open(trigger);
    await choose('等待断言', '检测画面变化结束节点');
    assert.deepEqual((await events()).at(-1), ['branch', 0, branch, 'visualChangeEnd']);
  }

  await main.getByRole('button', { name: '放大', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '流程总览' });
  await expect(dialog).toBeVisible();
  await open(dialog.getByRole('button', { name: '在“否”分支插入操作', exact: true }));
  await choose('组件操作', '判断勾选');
  assert.deepEqual((await events()).at(-1), ['branch', 0, 'no', 'checkedState']);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close this dialog' }).click();
  await expect(dialog).not.toBeVisible();

  await patchState({ steps: [] });
  await main.getByRole('button', { name: '还原位置', exact: true }).click();
  await open();
  const rootHeight = (await menu.boundingBox()).height;
  await menu.getByRole('menuitem', { name: '等待断言', exact: true }).hover();
  await expect(submenu).toHaveCount(1);
  await expect(menu.getByRole('menuitem', { name: '添加延时', exact: true })).toBeVisible();
  assert.equal((await menu.boundingBox()).height, rootHeight, 'A long submenu must not stretch the root menu');
  const itemBounds = await menu.getByRole('menuitem', { name: '等待出现', exact: true }).boundingBox();
  await page.mouse.move(itemBounds.x + 30, itemBounds.y + 15, { steps: 12 });
  await page.waitForTimeout(400);
  await expect(submenu).toHaveCount(1);
  await page.screenshot({ path: '/tmp/midscene-action-menu-desktop.png', animations: 'disabled' });
  await page.mouse.click(10, 10);
  await expect(menu).toHaveCount(0);
  const countBeforeKeyboard = (await events()).length;
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('menuitem', { name: '组件操作', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(menu.getByRole('menuitem', { name: '录制点击', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  assert.equal((await events()).length, countBeforeKeyboard + 1);
  assert.deepEqual((await events()).at(-1), ['insert', -1, 'tap']);
  await page.setViewportSize({ width: 375, height: 740 });
  await main.getByRole('button', { name: '还原位置', exact: true }).click();
  await open();
  await menu.getByRole('menuitem', { name: '等待断言', exact: true }).hover();
  await expect(submenu).toHaveCount(1);
  await expect.poll(async () => {
    const bounds = await submenu.boundingBox();
    return Boolean(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 375 && bounds.y + bounds.height <= 740);
  }).toBe(true);
  await page.screenshot({ path: '/tmp/midscene-action-menu-mobile.png', animations: 'disabled' });
  await menu.getByRole('menuitem', { name: '检测画面变化结束节点', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const logSteps = ['1111', '222'].map((value, index) => ({
    id: `log-${index}`, type: 'log', label: '输出日志', value,
  }));
  await patchState({ steps: logSteps });
  await main.getByRole('button', { name: '还原位置', exact: true }).click();
  const cards = main.locator('.appium-flow-step-card');
  await expect(cards).toHaveCount(2);
  await expect.poll(() => cards.evaluateAll((items) => items[0].offsetHeight === items[1].offsetHeight)).toBe(true);
  await patchState({ steps: [logSteps[0], { ...logSteps[1], value: '长日志内容'.repeat(80) }] });
  await expect.poll(() => cards.evaluateAll((items) => items[1].offsetHeight > items[0].offsetHeight)).toBe(true);
  await patchState({ steps: logSteps });
  await expect.poll(() => cards.evaluateAll((items) => items[0].offsetHeight === items[1].offsetHeight)).toBe(true);
  assert.deepEqual(errors, []);
  console.log('PASS: compact hover flyouts, pointer handoff, repeated actions, disabled actions, paste, branches, expanded view, keyboard, dismissal and viewport bounds');
} finally {
  await browser.close();
}

import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const original = { id: 'existing', name: '原脚本', appPackage: 'example.app', appActivity: '', deviceId: '', createdAt: '', updatedAt: '', steps: [{ id: 'one', type: 'noop', label: '空节点' }] };
let records = [original];
const saves = [];
let failSave = false;
let releaseSave;
let delaySave = false;
try {
  await page.route('**/__new-script-check', (route) => route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/tree')) return route.fulfill({ json: { xml: '<hierarchy />', activity: '' } });
    if (path.endsWith('/scripts') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      saves.push(body);
      if (delaySave) await new Promise((resolve) => { releaseSave = resolve; });
      if (failSave) return route.fulfill({ status: 500, json: { message: '模拟保存失败' } });
      const script = { ...original, ...body, id: body.id || 'new-id' };
      records = [...records.filter((item) => item.id !== script.id), script];
      return route.fulfill({ json: { script } });
    }
    if (path.endsWith('/scripts')) return route.fulfill({ json: { scripts: records } });
    errors.push(`Unexpected API ${path}`);
    return route.abort();
  });
  await page.goto(`${process.env.APP_URL || 'http://127.0.0.1:5173'}/__new-script-check`);
  await page.evaluate(async () => {
    const source = await (await fetch('/src/main.ts')).text();
    const { createApp } = await import(source.match(/"([^"\n]*\/vue\.js\?v=[^"]+)"/)[1]);
    const ElementPlus = (await import(source.match(/"([^"\n]*\/element-plus\.js\?v=[^"]+)"/)[1])).default;
    for (const path of ['/node_modules/element-plus/dist/index.css', '/node_modules/@vue-flow/core/dist/style.css', '/node_modules/@vue-flow/core/dist/theme-default.css', '/src/style.css', '/src/ui-refresh.css']) await import(path);
    const App = (await import('/src/appium-recorder/AppiumPage.vue')).default;
    const noop = () => {};
    createApp(App, {
      active: true, appPresets: [{ id: 'app', name: 'Test App', packageName: 'example.app' }], deviceActions: [],
      playgroundAvailable: false, playgroundDeviceId: '', playgroundFrameUrl: '', playgroundPreviewError: '', devicePreviewUrl: '',
      androidDevices: [], deviceWidth: 1080, deviceHeight: 2400, switchAndroidDevice: noop, triggerDeviceKey: noop,
      refreshDevicePreview: noop, swipeDevice: noop,
    }).use(ElementPlus).mount('#app');
  });
  const create = page.getByRole('button', { name: '新建', exact: true });
  const dialog = page.getByRole('dialog', { name: '新建脚本', exact: true });
  const name = page.getByPlaceholder('脚本名称', { exact: true });
  const cards = page.locator('#app .appium-flow-step-card');
  await expect(create).toBeVisible();
  assert.equal(await create.evaluate((button) => button.nextElementSibling?.textContent?.trim()), '保存');
  await create.click();
  await expect(dialog).toHaveCount(0);
  async function loadOriginal() {
    await page.getByRole('tab', { name: '脚本列表', exact: true }).click();
    await page.locator('.appium-script-list__item').filter({ hasText: '原脚本' }).getByRole('button', { name: '加载', exact: true }).click();
    await expect(name).toHaveValue('原脚本');
    await expect(cards).toHaveCount(1);
  }
  await loadOriginal();
  // Opened scripts prompt even when unchanged; cancel/close must preserve the draft.
  await create.click();
  await expect(dialog).toContainText('原脚本');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(name).toHaveValue('原脚本');
  await name.fill('修改草稿');
  await create.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(name).toHaveValue('修改草稿');
  await create.click();
  await dialog.getByRole('button', { name: '不保存并新建', exact: true }).click();
  await expect(name).toHaveValue('');
  await expect(cards).toHaveCount(0);
  assert.equal(saves.length, 0);
  assert.equal(records[0].name, '原脚本');
  await expect(page.locator('.appium-side-form .el-select')).toContainText('Test App');

  await loadOriginal();
  await name.fill('保存修改');
  await create.click();
  delaySave = true;
  await dialog.getByRole('button', { name: '保存并新建', exact: true }).click();
  await expect.poll(() => Boolean(releaseSave)).toBe(true);
  await expect(dialog.getByRole('button', { name: '不保存并新建', exact: true })).toBeDisabled();
  await expect(name).toHaveValue('保存修改');
  releaseSave();
  delaySave = false;
  await expect(dialog).toBeHidden();
  await expect(name).toHaveValue('');
  await expect(cards).toHaveCount(0);
  assert.equal(saves.at(-1).id, 'existing');
  assert.equal(records[0].name, '保存修改');

  await name.fill('未保存的新脚本');
  await create.click();
  failSave = true;
  await dialog.getByRole('button', { name: '保存并新建', exact: true }).click();
  await expect(page.getByText('模拟保存失败', { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue('未保存的新脚本');
  assert.equal(saves.at(-1).id, undefined, 'New scripts must never overwrite the previously opened script');
  failSave = false;
  await dialog.getByRole('button', { name: '保存并新建', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(name).toHaveValue('');
  assert.equal(records.find((item) => item.id === 'existing').name, '保存修改');
  assert.equal(records.find((item) => item.id === 'new-id').name, '未保存的新脚本');
  await name.fill('新草稿');
  await create.click();
  await expect(dialog).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '/tmp/midscene-new-script-dialog.png', animations: 'disabled' });
  assert.deepEqual(errors, []);
  console.log('PASS: new script, opened/draft confirmation, cancel/Escape/discard, save success/failure/in-flight protection, new IDs and retained app');
} finally {
  releaseSave?.();
  await browser.close();
}

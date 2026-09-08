import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
let text = 'old-text';
let failed = false;
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.route('**/__tree-check', (route) => route.fulfill({ contentType: 'text/html', body: '<div id="app" style="height:calc(100vh - 40px)"></div>' }));
  await page.route('**/api/**', (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/tree')) {
      return failed ? route.fulfill({ status: 500, json: { message: '刷新组件树失败：设备抓取失败' } })
        : route.fulfill({ json: { deviceId: 'test', activity: 'test/.Main', xml: `<hierarchy><node class="FrameLayout" bounds="[0,0][100,100]"><node class="TextView" text="${text}" bounds="[0,0][50,50]" /></node></hierarchy>` } });
    }
    return route.fulfill({ json: { scripts: [] } });
  });
  await page.goto('http://127.0.0.1:5173/__tree-check');
  await page.evaluate(async () => {
    const source = await (await fetch('/src/main.ts')).text();
    const { createApp, h } = await import(source.match(/"([^"\n]*\/vue\.js\?v=[^"]+)"/)[1]);
    const ElementPlus = (await import(source.match(/"([^"\n]*\/element-plus\.js\?v=[^"]+)"/)[1])).default;
    for (const file of ['/node_modules/element-plus/dist/index.css', '/node_modules/@vue-flow/core/dist/style.css', '/node_modules/@vue-flow/core/dist/theme-default.css', '/src/style.css', '/src/ui-refresh.css']) await import(file);
    const App = (await import('/src/appium-recorder/AppiumPage.vue')).default;
    const noop = () => {};
    createApp({ render: () => h(App, {
      active: false, appPresets: [], deviceActions: [], playgroundAvailable: false, playgroundDeviceId: 'test',
      playgroundFrameUrl: '', playgroundPreviewError: '', devicePreviewUrl: '', androidDevices: [],
      deviceWidth: 100, deviceHeight: 100, switchAndroidDevice: noop, triggerDeviceKey: noop,
      refreshDevicePreview: noop, swipeDevice: noop,
    }) }).use(ElementPlus).mount('#app');
  });
  const refresh = page.getByRole('button', { name: '刷新组件树', exact: true });
  const tree = page.locator('.appium-tree');
  await refresh.click();
  await expect(tree).toContainText('old-text');
  await tree.getByText('old-text', { exact: true }).click();
  const summary = page.locator('.appium-node-summary');
  await expect(summary).toContainText('old-text');
  assert.ok((await summary.boundingBox()).height <= 70);
  await expect(page.getByRole('dialog', { name: '组件详情' })).toHaveCount(0);
  const canvas = page.locator('#app .appium-flow-canvas--vue');
  const before = await canvas.boundingBox();
  assert.ok(before.height >= 300, `Canvas should use available height: ${before.height}`);
  assert.ok(before.y + before.height <= 1000, 'Canvas fits the first viewport');
  await summary.getByRole('button', { name: '详情', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '组件详情' });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('resource-id');
  await expect(detail).toContainText('old-text');
  await detail.getByRole('button', { name: 'Close this dialog' }).click();
  await expect(detail).toBeHidden();
  const after = await canvas.boundingBox();
  assert.equal(after.y, before.y);
  assert.equal(after.height, before.height);
  await page.screenshot({ path: '/tmp/midscene-compact-workbench.png', animations: 'disabled' });
  text = 'new-text';
  await refresh.click();
  await expect(tree).toContainText('new-text');
  await tree.getByText('new-text', { exact: true }).click();
  await expect(summary).toContainText('new-text');
  await expect(detail).toBeHidden();
  await expect(tree).not.toContainText('old-text');
  failed = true;
  await refresh.click();
  await expect(page.getByText('刷新组件树失败：设备抓取失败', { exact: true })).toBeVisible();
  await expect(tree).toContainText('new-text');
  failed = false;
  text = 'recovered-text';
  await refresh.click();
  await expect(tree).toContainText('recovered-text');
  await tree.getByText('recovered-text', { exact: true }).click();
  await summary.getByRole('button', { name: '详情', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(detail).toBeVisible();
  assert.ok((await detail.boundingBox()).width <= 390);
  await detail.getByRole('button', { name: 'Close this dialog' }).click();
  await expect(detail).toBeHidden();
  assert.deepEqual(errors, []);
  console.log('PASS: refresh updates same-ID nodes, failure is visible, recovery works');
} finally {
  await browser.close();
}

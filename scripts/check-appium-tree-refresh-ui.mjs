import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
let text = 'old-text';
let failed = false;
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.route('**/__tree-check', (route) => route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }));
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
    for (const file of ['/node_modules/element-plus/dist/index.css', '/src/style.css', '/src/ui-refresh.css']) await import(file);
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
  text = 'new-text';
  await refresh.click();
  await expect(tree).toContainText('new-text');
  await expect(tree).not.toContainText('old-text');
  failed = true;
  await refresh.click();
  await expect(page.getByText('刷新组件树失败：设备抓取失败', { exact: true })).toBeVisible();
  await expect(tree).toContainText('new-text');
  failed = false;
  text = 'recovered-text';
  await refresh.click();
  await expect(tree).toContainText('recovered-text');
  assert.deepEqual(errors, []);
  console.log('PASS: refresh updates same-ID nodes, failure is visible, recovery works');
} finally {
  await browser.close();
}

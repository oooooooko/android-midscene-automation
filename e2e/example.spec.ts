import { test, expect, type Page } from '@playwright/test';
import { summarizeTests } from '../src/analytics/summary';

const config = {
  runtime: { androidSdkPath: '', reportOutputPath: '' },
  midscene: { model: { provider: 'custom', baseUrl: '', apiKey: '', name: '', family: '' }, env: {} },
  scriptOptimizer: { model: { baseUrl: '', apiKey: '', name: '' } },
  appium: { model: { baseUrl: '', apiKey: '', name: '' }, promptOptimizer: { model: { baseUrl: '', apiKey: '', name: '' } }, screenshotReport: false },
};
async function mockApi(page: Page) {
  // All APIs are intercepted: tests never operate a real device or call a model.
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const payload = path === '/api/config' ? config
      : path === '/api/android-devices' ? { devices: [], currentDeviceId: '' }
      : path === '/api/app-presets' ? { apps: [] }
      : path === '/api/appium-version' ? { version: '3.5.0', source: 'local', message: '本机 Appium' }
      : path === '/api/analytics' ? { generatedAt: new Date().toISOString(), days: 0,
        midscene: summarizeTests([{ id: 'login', name: '登录测试' }, { id: 'empty', name: '未执行脚本' }], [
          { scriptId: 'login', scriptName: '登录测试', status: 'passed', startedAt: new Date().toISOString(), durationMs: 2000 },
          { scriptId: 'login', scriptName: '登录测试', status: 'failed', startedAt: new Date().toISOString(), durationMs: 1000 },
        ]), appium: summarizeTests([], []) }
      : path.includes('/variables') ? { variables: [] }
      : path.endsWith('/scripts') ? { scripts: [] } : { success: true };
    await route.fulfill({ json: payload });
  });
}
async function openMenu(page: Page, name: string) { await page.getByRole('navigation', { name: '页面导航' }).getByRole('button', { name, exact: true }).click(); }
test.beforeEach(async ({ page }) => { await mockApi(page); });

test('close active tabs, reopen from sidebar, and preserve form drafts', async ({ page }) => {
  await page.goto('/');
  await openMenu(page, '参数配置');
  const input = page.locator('#config-panel-basic input').first();
  await input.fill('/draft/sdk');
  await page.getByRole('button', { name: '关闭参数配置页签' }).click();
  await expect(page.getByRole('navigation').getByRole('button', { name: '参数配置', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: '参数配置', exact: true }).click();
  await expect(input).toHaveValue('/draft/sdk');
  await expect(page.getByRole('button', { name: '关闭参数配置页签' })).toBeVisible();
});

test('failed configuration load cannot submit defaults and can retry', async ({ page }) => {
  let failures = 1;
  await page.route('**/api/config', async route => {
    await route.fulfill(failures-- > 0 ? { status: 503, json: { message: '暂时不可用' } } : { json: config });
  });
  await page.goto('/');
  await openMenu(page, '参数配置');
  await expect(page.getByRole('alert').filter({ hasText: '参数配置加载失败' })).toBeVisible();
  await expect(page.locator('.config-page')).toHaveCount(0);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.config-page')).toBeVisible();
});

test('backend reconnect preserves form edits', async ({ page }) => {
  let offline = true;
  await page.route('**/api/android-devices', route => offline ? route.abort() : route.fulfill({ json: { devices: [], currentDeviceId: '' } }));
  await page.goto('/');
  await openMenu(page, '参数配置');
  await page.locator('#config-panel-basic input').first().fill('/my/draft');
  await expect(page.getByText('本地服务已断开，正在尝试重连。恢复连接后可继续编辑。')).toBeVisible();
  offline = false;
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(page.getByRole('button', { name: '重新连接', exact: true })).toHaveCount(0);
  await expect(page.locator('#config-panel-basic input').first()).toHaveValue('/my/draft');
});

test('Appium autosave retries a failed snapshot without requiring an edit', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/config/appium', async route => {
    attempts++;
    await route.fulfill(attempts === 1 ? { status: 503, json: { message: 'offline' } } : { json: { success: true } });
  });
  await page.goto('/');
  await openMenu(page, '参数配置');
  await page.getByRole('tab', { name: 'Appium配置', exact: true }).click();
  await page.locator('#config-panel-appium .el-switch').first().click();
  await expect(page.getByRole('button', { name: '重试保存' })).toBeVisible();
  await page.getByRole('button', { name: '重试保存' }).click();
  await expect(page.getByText('已自动保存', { exact: true })).toBeVisible();
  expect(attempts).toBe(2);
});

test('about caches version on navigation and supports forced refresh', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/appium-version', async route => {
    requests++;
    await route.fulfill({ json: { version: '3.5.0', source: 'local', message: '本机 Appium' } });
  });
  await page.goto('/');
  await openMenu(page, '关于');
  await expect(page.getByText('v3.5.0', { exact: true })).toBeVisible();
  await openMenu(page, '参数配置');
  await openMenu(page, '关于');
  expect(requests).toBe(1);
  await page.getByRole('button', { name: '刷新版本' }).click();
  await expect.poll(() => requests).toBe(2);
});

test('analysis separates engines, computes pass rates and includes scripts without runs', async ({ page }) => {
  await page.goto('/');
  await openMenu(page, '分析页');
  const midscene = page.getByRole('region', { name: 'Midscene 测试报告分析' });
  await expect(midscene.getByText('50.0%').first()).toBeVisible();
  await expect(midscene.getByRole('cell', { name: '未执行脚本', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Appium 测试报告分析' }).getByText('暂无脚本或测试记录')).toBeVisible();
  await page.getByRole('textbox', { name: '搜索 Midscene 脚本' }).fill('登录');
  await expect(midscene.getByRole('cell', { name: '未执行脚本', exact: true })).toHaveCount(0);
});

test('Appium toolbar stays inside header at 900px', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 850 });
  await page.goto('/');
  await openMenu(page, 'Appium');
  await expect(page.locator('.appium-header-actions')).toBeVisible();
  const toolbar = await page.locator('.appium-header-actions').boundingBox();
  const title = await page.locator('.layout-header__title').boundingBox();
  expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(900);
  expect(toolbar!.x >= title!.x + title!.width || toolbar!.y >= title!.y + title!.height).toBeTruthy();
  await page.screenshot({ path: 'test-results/appium-900.png', fullPage: true });
});


test('Appium draft warns before leaving even after its tab is closed', async ({ page }) => {
  await page.goto('/');
  await openMenu(page, 'Appium');
  await page.getByPlaceholder('脚本名称', { exact: true }).fill('未保存草稿');
  await page.getByRole('button', { name: '关闭Appium页签' }).click();
  const dialogPromise = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true });
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  expect(page.isClosed()).toBe(false);
  await page.getByRole('menuitem', { name: 'Appium', exact: true }).click();
  await expect(page.getByPlaceholder('脚本名称', { exact: true })).toHaveValue('未保存草稿');
});


test('analysis charts show real totals, switch granularity and expose point data', async ({ page }) => {
  await page.goto('/');
  await openMenu(page, '分析页');
  await expect(page.getByRole('region', { name: '测试数据图表' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Midscene 2 次，Appium 0 次', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '月执行量', exact: true }).click();
  await expect(page.getByText('最近 12 个月，按月汇总 · 执行次数')).toBeVisible();
  const trend = page.getByRole('img', { name: 'Midscene 与 Appium 执行趋势，左右方向键查看日期数据' });
  await trend.press('End');
  await expect(page.locator('.chart-caption [role="status"]')).toContainText('Midscene 2 次');
  await page.getByRole('region', { name: '测试执行趋势' }).getByRole('button', { name: 'Midscene', exact: true }).click();
  await expect(page.getByRole('region', { name: '测试执行趋势' }).getByRole('button', { name: 'Midscene', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: 'test-results/analysis-charts.png', fullPage: true });
});

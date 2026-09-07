import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

// Mount real page components without reading or changing the user's configuration.
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

try {
  await page.route('**/__config-tabs-check', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<div id="app" style="max-width:1180px;width:calc(100% - 48px);height:calc(100vh - 48px);margin:24px auto"></div><div id="generator-reference" hidden></div>',
  }));
  await page.route('**/api/**', (route) => route.abort());
  await page.goto(`${process.env.APP_URL || 'http://127.0.0.1:5173'}/__config-tabs-check`);
  await page.evaluate(async () => {
    const source = await (await fetch('/src/main.ts')).text();
    const { createApp, h, reactive } = await import(source.match(/"([^"\n]*\/vue\.js\?v=[^"]+)"/)[1]);
    const ElementPlus = (await import(source.match(/"([^"\n]*\/element-plus\.js\?v=[^"]+)"/)[1])).default;
    for (const path of ['/node_modules/element-plus/dist/index.css', '/src/style.css', '/src/ui-refresh.css']) await import(path);
    const ConfigPage = (await import('/src/pages/ConfigPage.vue')).default;
    const state = reactive({
      configForm: {
        appium: { model: { baseUrl: '', apiKey: '', name: '' } },
        runtime: { androidSdkPath: '/test/sdk', reportOutputPath: '/test/reports' },
        midscene: { model: { provider: 'custom', baseUrl: 'https://example.test/v1', apiKey: 'test-key', name: 'test-model', family: 'gpt-5' }, env: {} },
        scriptOptimizer: { model: { baseUrl: 'https://example.test/v1', apiKey: 'optimizer-key', name: 'optimizer' } },
      },
      appPresets: [{ id: 'test-app', name: 'Test App', packageName: 'example.app', createdAt: '', updatedAt: '' }],
      appPresetForm: { id: '', name: '', packageName: '' },
      testingModelKey: '', isSavingModelConfig: false, isSavingAppPreset: false,
      modelTestStatus: { midscene: '', scriptOptimizer: '' },
    });
    const events = [];
    window.configTest = { state, events };
    createApp({ render: () => h(ConfigPage, {
      ...state,
      onSaveModelConfig: () => events.push(['save']),
      onSaveAppPreset: () => events.push(['saveApp']),
      onEditAppPreset: (app) => events.push(['editApp', app.id]),
      onDeleteAppPreset: (id) => events.push(['deleteApp', id]),
      onTestModel: (key) => events.push(['testModel', key]),
      onUpdateMidsceneModelProvider: (provider) => {
        events.push(['provider', provider]);
        state.configForm.midscene.model.provider = provider;
      },
    }) }).use(ElementPlus).mount('#app');
    const GeneratorPage = (await import('/src/pages/GeneratorPage.vue')).default;
    createApp(GeneratorPage, {
      mode: 'manual', sourcePrompt: '', promptPresetId: '', generatedCodeDraft: '',
      form: { testName: '', promptTitle: '', appPresetId: '' }, appPresets: [], promptPresets: [], promptExample: '',
      steps: [], generatedCode: '', showGeneratedCode: false, generatedCodeEditing: false,
      generatedCodeEditSaving: false, isGenerating: false, importingTestCase: false, importedTestCaseFileName: '',
    }).use(ElementPlus).mount('#generator-reference');
  });

  const config = page.locator('#app');
  const tab = (name) => config.getByRole('tab', { name, exact: true });
  const panel = () => config.getByRole('tabpanel');
  const field = (scope, label) => scope.locator('.el-form-item').filter({ has: page.locator('.el-form-item__label').filter({ hasText: new RegExp(`^${label}$`) }) }).locator('input').first();
  await expect(config.getByRole('tab')).toHaveText(['基础配置', 'Midscene配置', 'Appium配置']);
  await expect(tab('基础配置')).toHaveAttribute('aria-selected', 'true');
  await expect(panel()).toHaveCount(1);
  await expect(panel().getByText('运行配置', { exact: true })).toBeVisible();
  await expect(panel().getByText('预设 App 参数', { exact: true })).toBeVisible();
  await expect(panel().getByText('模型配置', { exact: true })).toHaveCount(0);
  await field(panel(), 'Android SDK 路径').fill('/draft/sdk');
  await field(panel(), '回放报告目录').fill('/draft/reports');
  await field(panel(), 'App 名称').fill('Draft App');
  await field(panel(), 'App 包名').fill('example.draft');
  await panel().getByRole('button', { name: '保存运行配置', exact: true }).click();
  await panel().getByRole('button', { name: '保存 App', exact: true }).click();
  await panel().locator('.app-preset-row button').nth(0).click();
  await panel().locator('.app-preset-row button').nth(1).click();

  const matchedStyle = await page.evaluate(() => {
    const properties = ['backgroundColor', 'borderRadius', 'padding', 'fontSize', 'fontWeight', 'boxShadow'];
    const style = (selector) => {
      const css = getComputedStyle(document.querySelector(selector));
      return properties.map((key) => css[key]);
    };
    return [style('#app .subnav__item--active'), style('#generator-reference .subnav__item--active')];
  });
  assert.deepEqual(matchedStyle[0], matchedStyle[1], 'Tabs must match the actual generator page styling');
  await page.screenshot({ path: '/tmp/midscene-config-basic.png' });
  await tab('Midscene配置').click();
  await expect(panel()).toHaveCount(1);
  await expect(panel().getByText('模型配置', { exact: true })).toBeVisible();
  await expect(panel().getByText('脚本优化模型', { exact: true })).toBeVisible();
  const model = panel().locator('.config-model-grid > section').first();
  await field(model, 'Model Name').fill('draft-model');
  await model.getByRole('button', { name: '测试模型', exact: true }).click();
  await panel().locator('.config-model-grid > section').last().getByRole('button', { name: '测试模型', exact: true }).click();
  await panel().getByRole('button', { name: '保存模型配置', exact: true }).click();
  await model.locator('.el-select__wrapper').first().click();
  await page.getByRole('option', { name: '使用 Codex', exact: true }).click();
  await expect(model.getByText(/复用 Codex 登录态/)).toBeVisible();
  await model.locator('.el-select__wrapper').first().click();
  await page.getByRole('option', { name: '自定义提供方', exact: true }).click();
  await expect(field(model, 'Model Name')).toHaveValue('draft-model');
  await expect(page.getByRole('option', { name: '自定义提供方', exact: true })).toBeHidden();
  await page.screenshot({ path: '/tmp/midscene-config-model.png' });

  await model.locator('.el-select__wrapper').first().click();
  await expect(page.getByRole('option', { name: '使用 Codex', exact: true })).toBeVisible();
  await tab('Appium配置').click();
  await expect(page.getByRole('option', { name: '使用 Codex', exact: true })).toBeHidden();
  await expect(panel()).toHaveCount(1);
  await expect(panel().getByText('节点模型配置', { exact: true })).toBeVisible();
  await expect(panel().getByText('AI 识别模型', { exact: true })).toBeVisible();
  await field(panel(), 'Base URL').fill('https://vision.example.test/v1');
  await field(panel(), 'API Key').fill('vision-key');
  await field(panel(), 'Model Name').fill('vision-model');
  await panel().getByRole('button', { name: '测试模型', exact: true }).click();
  await panel().getByRole('button', { name: '保存模型配置', exact: true }).click();
  await page.screenshot({ path: '/tmp/midscene-config-appium.png' });
  await tab('基础配置').click();
  await expect(field(panel(), 'Android SDK 路径')).toHaveValue('/draft/sdk');
  await expect(field(panel(), '回放报告目录')).toHaveValue('/draft/reports');
  await expect(field(panel(), 'App 名称')).toHaveValue('Draft App');
  await expect(field(panel(), 'App 包名')).toHaveValue('example.draft');
  await tab('基础配置').press('ArrowRight');
  await expect(tab('Midscene配置')).toBeFocused();
  await expect(field(model, 'Model Name')).toHaveValue('draft-model');
  await tab('Midscene配置').press('End');
  await expect(tab('Appium配置')).toHaveAttribute('aria-selected', 'true');
  await expect(field(panel(), 'Model Name')).toHaveValue('vision-model');
  assert.deepEqual(await page.evaluate(() => window.configTest.events), [
    ['save'], ['saveApp'], ['editApp', 'test-app'], ['deleteApp', 'test-app'],
    ['testModel', 'midscene'], ['testModel', 'scriptOptimizer'], ['save'], ['provider', 'codex'], ['provider', 'custom'],
    ['testModel', 'appium'], ['save'],
  ]);

  const hex = panel().getByRole('textbox', { name: '十六进制背景色' });
  await expect(panel().locator(':scope > .config-appium-card')).toHaveCount(2);
  await expect(panel().locator('.config-appium-card').first().getByText('流程背景色', { exact: true })).toHaveCount(0);
  await expect(panel().locator('.config-appium-card').last().getByRole('button', { name: '保存背景色' })).toBeVisible();
  await expect(hex).toHaveValue('#d4e8dd');
  await panel().getByRole('button', { name: '选择颜色 #d5e6f5', exact: true }).click();
  await expect(hex).toHaveValue('#d5e6f5');
  await hex.fill('#xyz123');
  await expect(panel().getByText('请输入有效的十六进制颜色，如 #ABC 或 #AABBCC')).toBeVisible();
  await expect(panel().getByRole('button', { name: '保存背景色', exact: true })).toBeDisabled();
  await hex.fill('#AbC');
  await expect(panel().getByRole('button', { name: '保存背景色', exact: true })).toBeEnabled();
  await panel().locator('.el-color-picker__trigger').click();
  const picker = page.getByRole('tooltip').filter({ has: page.getByRole('button', { name: 'OK', exact: true }) });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(picker).toBeHidden();
  await panel().getByRole('button', { name: '恢复默认颜色', exact: true }).click();
  await expect(hex).toHaveValue('#d4e8dd');
  await panel().getByRole('button', { name: '保存背景色', exact: true }).click();
  await page.screenshot({ path: '/tmp/midscene-flow-background-settings.png', animations: 'disabled' });
  await page.setViewportSize({ width: 375, height: 850 });
  for (const name of ['基础配置', 'Midscene配置', 'Appium配置']) {
    await tab(name).click();
    const bounds = await config.getByRole('tablist').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 375, 'Tabs must stay inside a narrow viewport');
    assert.ok(await config.evaluate((el) => el.scrollWidth <= el.clientWidth), 'Configuration must not overflow horizontally');
    if (name === 'Midscene配置') await page.screenshot({ path: '/tmp/midscene-config-mobile.png' });
  }
  assert.deepEqual(errors, []);
  const backgrounds = await page.evaluate(() => {
    const color = (selector) => getComputedStyle(document.querySelector(selector)).backgroundColor;
    return [
      color('#config-panel-basic .el-card__body'),
      color('#config-panel-basic .config-module-card:last-child .el-card__body'),
      color('#config-panel-appium .el-card__body'),
      color('#config-panel-midscene .config-model-grid > section'),
    ];
  });
  assert.ok(backgrounds.every((color) => color === backgrounds[3]), `All configuration forms must share the Midscene background: ${backgrounds}`);
  console.log('PASS: config tab grouping, generator styling, draft retention, model forms/events, keyboard and narrow layout');
} finally {
  await browser.close();
}

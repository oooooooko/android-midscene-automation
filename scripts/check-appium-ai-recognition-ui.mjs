import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { PNG } from 'pngjs';

// Mount the real recorder while intercepting every device and persistence request.
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const saved = [];
const tests = [];
let records = [];
let testError = false;
const testImage = new PNG({ width: 120, height: 240 });
testImage.data.fill(128);
const imageBase64 = PNG.sync.write(testImage).toString('base64');
try {
  await page.route('**/__ai-recognition-check', (route) => route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/tree')) return route.fulfill({ json: {
      xml: '<hierarchy><node class="android.widget.FrameLayout" package="example.app" bounds="[0,0][1080,2400]" /></hierarchy>', activity: 'example.app/.Main',
    } });
    if (path.endsWith('/scripts') && request.method() === 'POST') {
      const data = request.postDataJSON();
      saved.push(data);
      const script = { ...data, id: 'test-script', createdAt: '', updatedAt: '' };
      records = [script];
      return route.fulfill({ json: { script } });
    }
    if (path.endsWith('/scripts')) return route.fulfill({ json: { scripts: records } });
    if (path.endsWith('/ai-recognition/test')) {
      tests.push(request.postDataJSON());
      return testError ? route.fulfill({ status: 500, json: { message: '模型不支持图片输入' } })
        : route.fulfill({ json: { result: false, reason: '画面正常，没有黑屏', durationMs: 123, imageBase64 } });
    }
    errors.push(`Unexpected API: ${path}`);
    return route.abort();
  });
  await page.goto(`${process.env.APP_URL || 'http://127.0.0.1:5173'}/__ai-recognition-check`);
  await page.evaluate(async () => {
    const source = await (await fetch('/src/main.ts')).text();
    const { createApp, h, reactive } = await import(source.match(/"([^"\n]*\/vue\.js\?v=[^"]+)"/)[1]);
    const ElementPlus = (await import(source.match(/"([^"\n]*\/element-plus\.js\?v=[^"]+)"/)[1])).default;
    for (const path of ['/node_modules/element-plus/dist/index.css', '/node_modules/@vue-flow/core/dist/style.css', '/node_modules/@vue-flow/core/dist/theme-default.css', '/src/style.css', '/src/ui-refresh.css']) await import(path);
    const App = (await import('/src/appium-recorder/AppiumPage.vue')).default;
    const state = reactive({ aiRecognitionModelConfigured: false, flowBackgroundColor: '#d5e6f5' });
    window.aiTestState = state;
    const noop = () => {};
    createApp({ render: () => h(App, {
      ...state, active: true, appPresets: [{ id: 'preset', name: 'Test App', packageName: 'example.app' }],
      deviceActions: [], playgroundAvailable: false, playgroundDeviceId: 'test-device', playgroundFrameUrl: '',
      playgroundPreviewError: '', devicePreviewUrl: '', androidDevices: [], deviceWidth: 1080, deviceHeight: 2400,
      switchAndroidDevice: noop, triggerDeviceKey: noop, refreshDevicePreview: noop, swipeDevice: noop,
    }) }).use(ElementPlus).mount('#app');
  });

  const main = page.locator('#app .appium-flow-canvas');
  await expect(main.locator('.appium-vue-flow')).toHaveCSS('background-color', 'rgb(213, 230, 245)');
  const menu = page.locator('.appium-action-menu:visible');
  async function insert(trigger, group, action) {
    await trigger.click();
    await menu.getByRole('menuitem', { name: group, exact: true }).hover();
    await menu.getByRole('menuitem', { name: action, exact: true }).click();
  }
  async function reset() {
    await page.getByRole('button', { name: '还原位置', exact: true }).click();
    await page.waitForTimeout(300);
  }
  async function save() {
    const count = saved.length;
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => saved.length).toBe(count + 1);
    return saved.at(-1).steps;
  }
  await page.getByPlaceholder('脚本名称', { exact: true }).fill('AI recognition test');
  await page.locator('.el-select').filter({ hasText: '选择预设 App 参数' }).locator('.el-select__wrapper').click();
  await page.getByRole('option', { name: 'Test App · example.app' }).click();
  await insert(main.getByRole('button', { name: '在开始后插入操作', exact: true }), '组件操作', '文字点击');
  const textDialog = page.getByRole('dialog', { name: '添加文字点击', exact: true });
  await textDialog.getByRole('button', { name: '添加', exact: true }).click();
  await expect(page.getByText('请输入要点击的文字', { exact: true })).toBeVisible();
  await textDialog.getByRole('textbox', { name: '点击文字', exact: true }).fill('音频设置');
  await expect(textDialog.locator('.el-select')).toContainText('精准匹配（完全一致）');
  await textDialog.getByRole('button', { name: '添加', exact: true }).click();
  await expect(textDialog).toBeHidden();
  await reset();
  await expect(main.locator('.appium-flow-branch-pill')).toHaveText(['匹配到文字', '未匹配到文字']);
  assert.ok(await main.locator('.appium-flow-branch-pill').evaluateAll((items) => items.every((el) => el.scrollWidth <= el.clientWidth)));
  const textSteps = await save();
  assert.equal(textSteps[0].type, 'textClick');
  assert.equal(textSteps[0].value, '音频设置');
  assert.equal(textSteps[0].selector, undefined);
  assert.equal(textSteps[0].flow.textMatch, 'exact');
  await main.locator('.appium-flow-step-card').click();
  const textEditor = main.locator('.appium-flow-editor');
  await textEditor.getByRole('textbox', { name: '点击文字', exact: true }).fill('设置');
  await textEditor.locator('.el-form-item').filter({ hasText: '文本匹配方式' }).locator('.el-select__wrapper').click();
  await page.getByRole('option', { name: '模糊匹配（包含）', exact: true }).click();
  await main.locator('.appium-flow-step-card').click();
  const changedText = await save();
  assert.equal(changedText[0].value, '设置');
  assert.equal(changedText[0].flow.textMatch, 'contains');
  await page.getByRole('button', { name: '放大', exact: true }).click();
  const textOverview = page.getByRole('dialog', { name: '流程总览' });
  await expect(textOverview.locator('.appium-flow-branch-pill')).toHaveText(['匹配到文字', '未匹配到文字']);
  await expect(textOverview.locator('.appium-vue-flow')).toHaveCSS('background-color', 'rgb(213, 230, 245)');
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/midscene-text-click.png', animations: 'disabled' });
  await textOverview.getByRole('button', { name: 'Close this dialog' }).click();
  await main.getByTitle('删除节点', { exact: true }).click();
  await expect(main.locator('.appium-flow-step-card')).toHaveCount(0);
  await reset();
  await insert(main.getByRole('button', { name: '在开始后插入操作', exact: true }), '设备操作', '启动相册');
  await expect(main.locator('.appium-flow-step-card')).toContainText('启动相册');
  const gallerySteps = await save();
  assert.equal(gallerySteps[0].type, 'openGallery');
  assert.equal(gallerySteps[0].flow.nodeKind, 'action');
  assert.equal(gallerySteps[0].value, undefined);
  await reset();
  await main.getByTitle('删除节点', { exact: true }).click();
  await expect(main.locator('.appium-flow-step-card')).toHaveCount(0);
  await reset();
  await insert(main.getByRole('button', { name: '在开始后插入操作', exact: true }), '流程控制', '终止流程');
  await expect(main.locator('.appium-flow-step-card')).toContainText('终止流程');
  const endSteps = await save();
  assert.equal(endSteps[0].type, 'endFlow');
  assert.equal(endSteps[0].flow.nodeKind, 'action');
  await reset();
  await main.getByTitle('删除节点', { exact: true }).click();
  await expect(main.locator('.appium-flow-step-card')).toHaveCount(0);
  await insert(main.getByRole('button', { name: '在开始后插入操作', exact: true }), '等待断言', 'AI 识别');
  const add = page.getByRole('dialog', { name: '添加 AI 识别' });
  await add.getByRole('button', { name: '添加', exact: true }).click();
  await expect(add.getByText('请输入 AI 识别内容', { exact: true })).toBeVisible();
  await add.locator('textarea').fill('检查当前画面有没有显示黑屏');
  await add.getByRole('button', { name: '添加', exact: true }).click();
  await expect(add).toBeHidden();
  await reset();
  await expect(main.locator('.appium-flow-branch-pill')).toHaveText(['true', 'false']);
  await expect(main.getByRole('img', { name: 'AI 识别模型未配置' })).toBeVisible();
  const initial = await save();
  assert.equal(initial[0].type, 'aiRecognition');
  assert.equal(initial[0].flow.nodeKind, 'condition');
  assert.equal(initial[0].selector, undefined, 'No selected component is required');
  assert.equal(initial[0].value, '检查当前画面有没有显示黑屏');

  await main.getByRole('button', { name: '测试 AI 识别', exact: true }).click();
  const testDialog = page.getByRole('dialog', { name: '测试 AI 识别', exact: true });
  await expect(testDialog.getByRole('alert')).toContainText('Appium配置');
  assert.equal(tests.length, 0, 'Missing configuration must not send a model request');
  await testDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => { window.aiTestState.aiRecognitionModelConfigured = true; });
  await expect(main.getByRole('img', { name: 'AI 识别模型未配置' })).toHaveCount(0);
  await main.getByRole('button', { name: '测试 AI 识别', exact: true }).click();
  await expect(testDialog.locator('.ai-recognition-test__result strong')).toHaveText('false');
  await expect(testDialog).toContainText('画面正常，没有黑屏');
  await expect.poll(() => testDialog.locator('.el-image img').evaluate((img) => img.naturalWidth)).toBe(120);
  await testDialog.locator('.el-image img').click();
  await expect(page.locator('.el-image-viewer__wrapper')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.el-image-viewer__wrapper')).toBeHidden();
  assert.deepEqual(tests.at(-1), { deviceId: 'test-device', prompt: '检查当前画面有没有显示黑屏', timeoutMs: 60000 });
  await expect(testDialog).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '/tmp/midscene-ai-recognition-test.png', animations: 'disabled' });
  testError = true;
  await testDialog.getByRole('button', { name: '重新测试', exact: true }).click();
  await expect(testDialog.getByRole('alert')).toContainText('模型不支持图片输入');
  await expect(testDialog.locator('.ai-recognition-test__result')).toHaveCount(0);
  await testDialog.getByRole('button', { name: '关闭', exact: true }).click();

  await main.locator('.appium-flow-step-card').first().click();
  const editor = main.locator('.appium-flow-editor');
  await expect(editor.getByRole('combobox')).toBeDisabled();
  await expect(editor.getByText('可选步骤', { exact: true })).toHaveCount(0);
  await expect(editor.getByText('指定文本（可选）', { exact: true })).toHaveCount(0);
  await editor.locator('textarea').fill('识别当前按钮是否可用');
  await main.locator('.appium-flow-step-card').first().click();
  assert.equal((await save())[0].value, '识别当前按钮是否可用');
  await reset();
  await insert(main.getByRole('button', { name: '在“true”分支插入操作', exact: true }), '流程控制', '输出日志');
  const logDialog = page.getByRole('dialog', { name: '添加输出日志', exact: true });
  await expect(logDialog.getByRole('textbox', { name: '日志关键字', exact: true })).toHaveValue('stageLog');
  await logDialog.getByRole('button', { name: '添加', exact: true }).click();
  await expect(page.getByText('请输入日志内容', { exact: true })).toBeVisible();
  await logDialog.getByRole('textbox', { name: '日志内容', exact: true }).fill('进入当前分支');
  await page.screenshot({ path: '/tmp/midscene-stage-log-dialog.png' });
  await logDialog.getByRole('button', { name: '添加', exact: true }).click();
  await expect(logDialog).toBeHidden();
  await reset();
  const logCard = main.locator('.appium-flow-step-card').filter({ hasText: '输出日志' });
  await expect(logCard).toContainText('stageLog:进入当前分支');
  await logCard.click();
  const logEditor = main.locator('.appium-flow-editor');
  const keyword = logEditor.locator('.el-form-item').filter({ hasText: '日志关键字' }).locator('input');
  await keyword.fill('loginLog');
  await logEditor.locator('textarea').fill('自定义内容');
  await logCard.click();
  await reset();
  await insert(main.getByRole('button', { name: '在“false”分支插入操作', exact: true }), '流程控制', '空节点');
  const withBranches = await save();
  assert.equal(withBranches.length, 3);
  const logStep = withBranches.find((step) => step.type === 'log');
  assert.equal(logStep.logPrefix, 'loginLog');
  assert.equal(logStep.value, '自定义内容');
  for (const branch of ['yes', 'no']) {
    const child = withBranches.find((step) => step.flow?.parentBranch === branch);
    assert.equal(child.flow.parentConditionId, initial[0].id);
    assert.equal(withBranches[0].flow[`${branch}TargetId`], child.id);
  }
  await logCard.locator('..').getByTitle('复制节点', { exact: true }).click();
  const trueInsert = main.getByRole('button', { name: '在“true”分支插入操作', exact: true }).first();
  await trueInsert.click();
  await menu.getByRole('menuitem', { name: '粘贴 1 个节点', exact: true }).click();
  await expect(logCard).toHaveCount(2);
  await reset();
  await trueInsert.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /粘贴/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.aiTestState.aiRecognitionModelConfigured = false; });
  await page.getByRole('button', { name: '放大', exact: true }).click();
  const expanded = page.getByRole('dialog', { name: '流程总览' });
  await expect(expanded.locator('.appium-flow-branch-pill')).toHaveText(['true', 'false']);
  await expect(expanded.getByRole('img', { name: 'AI 识别模型未配置' })).toBeVisible();
  await expect(expanded.getByRole('button', { name: '测试 AI 识别' })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/midscene-ai-recognition-flow.png', animations: 'disabled' });
  await page.evaluate(() => { window.aiTestState.aiRecognitionModelConfigured = true; });
  await expect(expanded.getByRole('img', { name: 'AI 识别模型未配置' })).toHaveCount(0);
  testError = false;
  await expanded.getByRole('button', { name: '测试 AI 识别' }).click();
  await expect(testDialog.locator('.ai-recognition-test__result strong')).toHaveText('false');
  assert.equal(tests.at(-1).prompt, '识别当前按钮是否可用');
  await page.setViewportSize({ width: 375, height: 850 });
  const bounds = await testDialog.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 375);
  assert.ok(await testDialog.evaluate((el) => el.scrollWidth <= el.clientWidth));
  assert.deepEqual(errors, []);
  console.log('PASS: AI node creation/validation, missing-model warning, test results/errors, editor/persistence, true/false branches, expanded view, narrow dialog');
} catch (error) {
  await page.screenshot({ path: '/tmp/midscene-ai-recognition-failed.png' });
  throw error;
} finally {
  await browser.close();
}

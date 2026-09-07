import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import type { AppiumReplayFrame } from '../server/appium-recorder/report';

const root = await mkdtemp(join(tmpdir(), 'report-steps-'));
process.env.ANDROID_MIDSCENE_DATA_ROOT = root;
const browser = await chromium.launch({ headless: true });
try {
  const { createAppiumReplayReport } = await import('../server/appium-recorder/report');
  const startedAt = new Date('2026-09-07T00:00:00Z');
  const png = new PNG({ width: 10, height: 20 });
  png.data.fill(160);
  const imageBase64 = PNG.sync.write(png).toString('base64');
  const fixtures: [string, string, AppiumReplayFrame['phase'], string][] = [
    ['parent', '主脚本', 'before', '执行前'],
    ['child', '连接脚本', 'before', '执行前'],
    ['child', '连接脚本', 'after', '成功'],
    ['parent', '主脚本', 'after', '成功'],
    ['child', '连接脚本', 'before', '执行前'],
    ['child', '连接脚本', 'error', '失败'],
    ['stopped', '主脚本', 'stopped', '已终止'],
    ['unfinished', '主脚本', 'before', '执行前'],
  ];
  const frames = fixtures.map(([nodeId, scriptName, phase, status], index) => ({
    sequence: index + 1, scriptName, nodeId, nodeNumber: 1, nodeLabel: nodeId,
    nodeType: nodeId === 'parent' ? 'textClick' : 'noop', note: '',
    selector: nodeId === 'parent' ? '精准匹配：音频设置<b>文字</b>' : '', phase, status, imageBase64,
    logContent: index === 2 ? 'stageLog:第一行\ncustom:<b>纯文本</b>' : undefined,
    capturedAt: new Date(startedAt.getTime() + index * 1000).toISOString(),
  }));
  const result = await createAppiumReplayReport({
    script: { id: 'test', name: '步骤合并测试', appPackage: 'test', appActivity: '', deviceId: 'test', steps: [], createdAt: '', updatedAt: '' },
    deviceId: 'test', success: false, output: 'stageLog:test', startedAt,
    completedAt: new Date(startedAt.getTime() + 8000), frames,
  });
  const html = await readFile(result.htmlReportPath, 'utf8');
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(html);
  await expect(page.locator('.frame-item')).toHaveCount(5);
  await expect(page.locator('.thumbnail')).toHaveCount(8);
  await expect(page.locator('.frame-log:not(.frame-click-text)')).toHaveText('stageLog:第一行\ncustom:<b>纯文本</b>');
  await expect(page.locator('.frame-click-text')).toHaveText('精准匹配：音频设置<b>文字</b>');
  await expect(page.locator('.frame-log b')).toHaveCount(0);
  await expect(page.locator('.frame-subtitle')).toHaveText(['成功', '成功', '失败', '已终止', '未完成']);
  const activeSteps = [0, 1, 1, 0, 2, 2, 3, 4];
  for (const [index, step] of activeSteps.entries()) {
    if (index) await page.locator('#next').click();
    await expect(page.locator('.frame-item.active')).toHaveAttribute('data-step', String(step));
    await expect(page.locator('#phase')).toHaveText({ before: '执行前', after: '执行后', error: '失败', stopped: '已终止' }[frames[index]!.phase]);
  }
  await page.locator('.frame-item').nth(1).click();
  await expect(page.locator('#node-log')).toHaveText('stageLog:第一行\ncustom:<b>纯文本</b>');
  await expect(page.locator('#node-log')).toBeVisible();
  await expect(page.locator('#phase')).toHaveText('执行前');
  await page.locator('#next').click();
  await expect(page.locator('#phase')).toHaveText('执行后');
  await page.locator('.frame-item').first().click();
  await expect(page.locator('#selector')).toHaveText('精准匹配：音频设置<b>文字</b>');
  await expect(page.locator('#node-log')).toBeHidden();
  await page.screenshot({ path: '/tmp/midscene-report-merged-steps.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const listBounds = await page.locator('#step-list').boundingBox();
  assert.ok(listBounds && listBounds.x >= 0 && listBounds.x + listBounds.width <= 390);
  await expect(page.locator('.frame-item')).toHaveCount(5);
  assert.deepEqual(errors, []);
  console.log('PASS: merged steps, linked scripts, repeated executions, failure/stopped/incomplete, frame navigation, mobile');
} finally {
  await browser.close();
  await rm(root, { recursive: true, force: true });
}

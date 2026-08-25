import { expect } from '@playwright/test';
import { test } from './fixture';

test('midscene admin shell loads', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173');
  await expect(page.getByText('脚本工作台')).toBeVisible();
});

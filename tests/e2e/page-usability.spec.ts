import { expect, test, type Page } from '@playwright/test';
async function initialize(page: Page, withEntry = true) {
  await page.clock.setFixedTime(new Date('2026-11-06T12:00:00+08:00'));
  await page.goto('./');
  await page.getByLabel('账本名称').fill('虚构逐页验收');
  await page.getByLabel('解锁密码', { exact: true }).fill('fictional-pages-review');
  await page.getByLabel('再次输入密码', { exact: true }).fill('fictional-pages-review');
  await page.getByRole('button', { name: '创建账本', exact: true }).click();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本', exact: true }).click();
  if (!withEntry) return;
  await page.goto('./#/accounts');
  await page.getByRole('button', { name: '添加账户', exact: true }).click();
  await page.getByRole('button', { name: '现金 随身现金、备用金', exact: true }).click();
  const form = page.getByRole('dialog', { name: '添加账户', exact: true });
  await form.getByLabel('账户名称').fill('虚构现金');
  await form.getByLabel('账户里有多少钱（元）').fill('1000');
  await form.getByLabel('从什么时候开始记').fill('2026-01-01T00:00');
  await form.getByRole('button', { name: '保存账户', exact: true }).click();
  await page.goto('./#/');
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  const editor = page.getByRole('dialog', { name: '记一笔', exact: true });
  await editor.getByLabel('金额', { exact: true }).fill('10');
  await editor.getByRole('button', { name: '停车费', exact: true }).click();
  await editor.getByLabel('备注', { exact: true }).fill('虚构停车费10元');
  await editor.getByRole('button', { name: '付款账户', exact: true }).click();
  await page
    .getByRole('dialog', { name: '选择资金账户' })
    .getByRole('button', { name: '虚构现金', exact: true })
    .click();
  await editor.getByRole('button', { name: '保存账目', exact: true }).click();
  await expect(editor).toBeHidden();
}

test('隐藏金额同时保护流水、小计和含金额的备注，恢复显示不改账', async ({ page }) => {
  await initialize(page);
  await page.goto('./#/accounts');
  await page.getByRole('button', { name: '虚构现金，余额 ¥ 990.00', exact: true }).click();
  await expect(page.locator('.entry-value')).toContainText('10.00');
  await page.getByRole('button', { name: '隐藏金额', exact: true }).click();
  await expect(page.locator('.entry-value')).toHaveText('••••••');
  await expect(page.locator('.day-group')).toContainText('金额已隐藏');
  await expect(page.locator('.note-preview')).toHaveCount(0);
  await page.getByRole('button', { name: '显示金额', exact: true }).click();
  await expect(page.locator('.assets-total')).toContainText('990.00');
  await expect(page.locator('.entry-value')).toContainText('10.00');
  await expect(page.locator('.note-preview')).toContainText('虚构停车费10元');
});

test('统计筛选收起仍可见并可清除，切换范围不残留钻取选择或无效月份', async ({ page }) => {
  await initialize(page);
  await page.goto('./#/statistics');
  await page.locator('.chart-row').first().click();
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.getByLabel('统计账户').selectOption({ label: '虚构现金' });
  await page.getByRole('button', { name: '筛选 · 已启用', exact: true }).click();
  await expect(page.locator('.filter-panel')).toHaveCount(0);
  await expect(page.locator('.report-filter-summary')).toContainText('虚构现金');
  await expect(page.getByRole('heading', { name: '当前范围 · 明细', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.locator('.report-filter-summary')).toHaveCount(0);
  await page.getByLabel('统计月份').fill('');
  await page.getByLabel('统计月份').dispatchEvent('change');
  await expect(page.getByLabel('统计月份')).toHaveValue('2026-11');
  await expect(page.locator('.report-summary')).toContainText('10.00');
  if (await page.getByLabel('统计月份').evaluate((input) => (input as HTMLInputElement).type === 'month'))
    await expect(page.locator('.month-input')).toContainText('2026年11月');
  else await expect(page.getByLabel('统计月份')).toBeVisible();
});

test('本地账本优先、事件空状态单一、备注可直达且账户选择有反馈', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await initialize(page);
  await page.goto('./#/books');
  const local = await page.locator('[data-book-id]').first().boundingBox();
  const login = await page.getByRole('button', { name: '首次开启同步', exact: true }).boundingBox();
  expect(local!.y).toBeLessThan(login!.y);
  await page.goto('./#/events');
  await expect(page.getByRole('heading', { name: '暂时没有待办', exact: true })).toBeVisible();
  await expect(page.getByText('暂无事项', { exact: true })).toHaveCount(0);
  await page.goto('./#/settings');
  await expect(page.locator('.settings-profile')).toContainText('虚构逐页验收 · 管理账本');
  await page.getByRole('button', { name: /^回收站/ }).click();
  await expect(page.getByRole('dialog', { name: '回收站', exact: true })).toContainText('回收站是空的');
  await page
    .getByRole('dialog', { name: '回收站', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.goto('./#/');
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: '填写备注 · 识别金额和分类', exact: true }).click();
  await expect(page.getByLabel('备注', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: '付款账户', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '选择资金账户' });
  await picker.getByRole('button', { name: '虚构现金', exact: true }).click();
  await page.getByRole('button', { name: '付款账户', exact: true }).click();
  await expect(picker.getByRole('button', { name: '虚构现金', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

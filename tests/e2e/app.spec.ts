import { expect, test, type Page } from '@playwright/test';
async function initialize(page: Page) {
  await page.goto('./');
  await page.getByLabel('账本名称').fill('虚构验收账本');
  await page.getByLabel('解锁口令', { exact: true }).fill('fictional-test-password');
  await page.getByRole('button', { name: '创建并继续' }).click();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本' }).click();
  await expect(page.getByText('虚构验收账本', { exact: true })).toBeVisible();
}
async function createAccount(page: Page) {
  await page.goto('./#/accounts');
  await page.getByRole('button', { name: '添加账户', exact: true }).click();
  const form = page.getByRole('dialog', { name: '添加共用账户' });
  await form.getByLabel('账户名称').fill('虚构现金');
  await form.getByLabel('期初余额（元）').fill('1000');
  await form.getByLabel('起算日期时间').fill('2026-01-01T00:00');
  await form.getByRole('button', { name: '保存账户' }).click();
  await expect(page.getByText('虚构现金', { exact: true })).toBeVisible();
}
test('空白安装、保存编辑、主要页面和离线重开', async ({ page, context }, info) => {
  await initialize(page);
  await createAccount(page);
  await page.goto('./#/');
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  const editor = page.getByRole('dialog', { name: '记一笔', exact: true });
  await editor.getByLabel('金额', { exact: true }).fill('23.45');
  await editor.getByRole('button', { name: '早餐', exact: true }).click();
  await editor.getByLabel('备注 · 粘贴银行短信即可识别').fill('虚构测试早餐');
  await editor.getByRole('button', { name: '付款账户', exact: true }).click();
  await page.getByRole('dialog', { name: '选择资金账户' }).getByRole('button', { name: '虚构现金' }).click();
  await editor.getByRole('button', { name: '保存账目' }).click();
  await expect(editor).toBeHidden();
  await page.getByRole('button').filter({ hasText: '虚构测试早餐' }).click();
  await page.getByRole('button', { name: '编辑账目' }).click();
  await page.getByRole('dialog', { name: '编辑账目' }).getByLabel('金额', { exact: true }).fill('20.00');
  await page.getByRole('button', { name: '保存账目' }).click();
  await expect(page.getByText('−20.00', { exact: true })).toBeVisible();
  for (const route of ['accounts', 'events', 'statistics', 'settings', 'books']) {
    await page.goto(`./#/${route}`);
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto('./#/');
  await page.screenshot({ path: `artifacts/ui-${info.project.name}.png`, fullPage: true });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: '解锁 Bes记账' })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await page.getByLabel('解锁口令', { exact: true }).fill('fictional-test-password');
  await page.getByRole('button', { name: '解锁账本', exact: true }).click();
  await expect(page.getByText('−20.00', { exact: true })).toBeVisible();
  await context.setOffline(false);
});
test('短信确认与日期不被分类选择重置', async ({ page }) => {
  await initialize(page);
  await createAccount(page);
  await page.goto('./#/');
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  const editor = page.getByRole('dialog', { name: '记一笔', exact: true });
  await editor.getByLabel('发生时间').fill('2026-10-01T12:00');
  await editor.getByRole('button', { name: '全部', exact: true }).click();
  await page.getByRole('dialog', { name: '全部分类' }).getByRole('button', { name: '餐饮 早餐' }).click();
  await expect(editor.getByLabel('发生时间')).toHaveValue('2026-10-01T12:00');
  await editor
    .getByLabel('备注 · 粘贴银行短信即可识别')
    .fill('尾号1234卡2026年10月20日08:09支出(消费示例店)6.50元，余额2,800.50元。【工商银行】');
  await editor.getByRole('button', { name: '重新识别短信' }).click();
  await expect(editor.getByText('金额 ¥ 6.50 · 支出')).toBeVisible();
  await editor.getByRole('button', { name: '采用并继续核对' }).click();
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('6.50');
  await expect(editor.getByLabel('发生时间')).toHaveValue(/^2026-10-20T08:09(?::00)?$/);
});

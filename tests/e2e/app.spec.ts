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
  await page
    .getByRole('dialog', { name: '选择账户类型' })
    .getByRole('button', { name: '现金 随身现金、备用金' })
    .click();
  const form = page.getByRole('dialog', { name: '添加账户', exact: true });
  await form.getByLabel('账户名称').fill('虚构现金');
  await form.getByLabel('账户里有多少钱（元）').fill('1000');
  await form.getByLabel('从什么时候开始记').fill('2026-01-01T00:00');
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
  await editor.getByRole('button', { name: '修改发生时间' }).click();
  await page
    .getByRole('dialog', { name: '发生时间', exact: true })
    .getByLabel('发生时间')
    .fill('2026-10-01T12:00');
  await page
    .getByRole('dialog', { name: '发生时间', exact: true })
    .getByRole('button', { name: '确定' })
    .click();
  await editor.getByRole('button', { name: '全部', exact: true }).click();
  await page.getByRole('dialog', { name: '全部分类' }).getByRole('button', { name: '餐饮 早餐' }).click();
  await expect(editor.getByRole('button', { name: '修改发生时间' })).toContainText('2026-10-01 12:00');
  await editor
    .getByLabel('备注 · 粘贴银行短信即可识别')
    .fill('尾号1234卡2026年10月20日08:09支出(消费示例店)6.50元，余额2,800.50元。【工商银行】');
  await editor.getByRole('button', { name: '重新识别短信' }).click();
  await expect(editor.getByText('金额 ¥ 6.50 · 支出')).toBeVisible();
  await editor.getByRole('button', { name: '采用并继续核对' }).click();
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('6.50');
  await expect(editor.getByRole('button', { name: '修改发生时间' })).toContainText('2026-10-20 08:09');
});
test('四种借贷草稿独立保留，预算取消不生效且关闭保留金额', async ({ page }) => {
  await initialize(page);
  await page.getByRole('button', { name: '预算 关' }).click();
  await page.getByLabel('预算金额（元）').fill('500');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '预算 关' })).toBeVisible();
  await page.getByRole('button', { name: '预算 关' }).click();
  await page.getByLabel('预算金额（元）').fill('800');
  await page.getByRole('button', { name: '启用预算' }).click();
  await page.getByRole('button', { name: '预算 开' }).click();
  await page.getByRole('button', { name: '预算 关' }).click();
  await expect(page.getByLabel('预算金额（元）')).toHaveValue('800.00');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  const editor = page.getByRole('dialog', { name: '记一笔', exact: true });
  await editor.getByRole('button', { name: '借贷', exact: true }).click();
  await editor.getByLabel('金额', { exact: true }).fill('100');
  await editor.getByRole('button', { name: '还款', exact: true }).click();
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('');
  await editor.getByLabel('金额', { exact: true }).fill('110');
  await editor.getByRole('button', { name: '借入', exact: true }).click();
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('100');
  await editor.getByRole('button', { name: '还款', exact: true }).click();
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('110');
});
test('借还总额与统计利息同源，资金账户余额保持准确', async ({ page }) => {
  await initialize(page);
  await createAccount(page);
  await page.getByRole('button', { name: '添加账户', exact: true }).click();
  await page
    .getByRole('dialog', { name: '选择账户类型' })
    .getByRole('button', { name: '应收 / 应付 别人欠我的钱、我欠别人的钱' })
    .click();
  const accountForm = page.getByRole('dialog', { name: '添加账户', exact: true });
  await accountForm.getByLabel('对方怎么称呼').fill('虚构往来');
  await accountForm.getByLabel('从什么时候开始记').fill('2026-01-01T00:00');
  await accountForm.getByRole('button', { name: '保存账户' }).click();
  await expect(accountForm).toBeHidden();
  await page.goto('./#/');
  for (const [type, amount, source, destination] of [
    ['借入', '100', '虚构往来', '虚构现金'],
    ['还款', '110', '虚构现金', '虚构往来'],
  ]) {
    await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
    const form = page.getByRole('dialog', { name: '记一笔', exact: true });
    await form.getByRole('button', { name: '借贷', exact: true }).click();
    await form.getByRole('button', { name: type, exact: true }).click();
    await form.getByLabel('金额', { exact: true }).fill(amount);
    if (type === '还款') {
      await form.getByRole('button', { name: /包含利息/ }).click();
      await form.getByLabel('包含利息（已计入总额）').fill('10');
      await expect(form.getByText('本金 ¥ 100.00 · 包含利息 ¥ 10.00')).toBeVisible();
    }
    await form.locator('.account-direction > button').first().click();
    await page.getByRole('dialog', { name: '选择资金账户' }).getByRole('button', { name: source }).click();
    await form.locator('.account-direction > button').last().click();
    await page
      .getByRole('dialog', { name: '选择资金账户' })
      .getByRole('button', { name: destination })
      .click();
    await form.getByRole('button', { name: '保存账目' }).click();
    await expect(form).toBeHidden();
  }
  await page.goto('./#/accounts');
  await expect(page.getByRole('button', { name: /余额 ¥ 990[.]00/ })).toBeVisible();
  await page.goto('./#/statistics');
  await expect(page.locator('.entry-row')).toHaveCount(1);
  await expect(page.locator('.entry-row').getByText('还款利息', { exact: true })).toBeVisible();
  await expect(page.locator('.entry-row .entry-value')).toHaveText(/−10\.00\s*业务总额 110\.00/);
});

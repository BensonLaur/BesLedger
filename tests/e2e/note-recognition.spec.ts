import { expect, test, type Page } from '@playwright/test';
test.use({ reducedMotion: 'reduce' });
const password = 'fictional-note-recognition-password';
async function setup(page: Page) {
  await page.goto('./');
  await page.getByLabel('账本名称').fill('虚构手写备注测试账');
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByLabel('再次输入密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账本', exact: true }).click();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本', exact: true }).click();
  await page.goto('./#/accounts');
  await page.getByRole('button', { name: '添加账户', exact: true }).click();
  await page
    .getByRole('dialog', { name: '选择账户类型' })
    .getByRole('button', { name: '现金 随身现金、备用金', exact: true })
    .click();
  const account = page.getByRole('dialog', { name: '添加账户', exact: true });
  await account.getByLabel('账户名称').fill('虚构备注现金');
  await account.getByLabel('账户里有多少钱（元）').fill('1000');
  await account.getByLabel('从什么时候开始记').fill('2026-01-01T00:00');
  await account.getByRole('button', { name: '保存账户', exact: true }).click();
  await expect(account).toBeHidden();
  await page.goto('./#/');
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  const editor = page.getByRole('dialog', { name: '记一笔', exact: true });
  await editor.getByRole('button', { name: '付款账户', exact: true }).click();
  await page
    .getByRole('dialog', { name: '选择资金账户' })
    .getByRole('button', { name: '虚构备注现金', exact: true })
    .click();
  return editor;
}
test('手写备注金额与用途识别，确认前不覆盖，确认后保留日期和账户，保存重开仍准确', async ({ page }, info) => {
  const form = await setup(page);
  await form.getByLabel('金额', { exact: true }).fill('77.00');
  const date = await form.getByRole('button', { name: '修改发生时间', exact: true }).innerText();
  let previous = '77.00';
  for (const [text, amount, category] of [
    ['停车费10元', '10.00', '停车费'],
    ['停车费10块', '10.00', '停车费'],
    ['停车费 10 元', '10.00', '停车费'],
    ['泊车十块五', '10.50', '停车费'],
    ['地铁2号线 8', '8.00', '地铁'],
  ]) {
    await form.getByLabel('备注', { exact: true }).fill(text);
    await form.getByRole('button', { name: '识别备注', exact: true }).click();
    await expect(form.locator('.recognition-panel')).toContainText(`金额 ¥ ${amount} · 支出`);
    await expect(form.getByLabel('金额', { exact: true })).toHaveValue(previous);
    await form.getByRole('button', { name: '采用并继续核对', exact: true }).click();
    await expect(form.getByLabel('金额', { exact: true })).toHaveValue(amount);
    await expect(form.getByRole('button', { name: `当前分类：${category}`, exact: true })).toBeVisible();
    await expect(form.getByRole('button', { name: '修改发生时间', exact: true })).toHaveText(date);
    await expect(form.getByRole('button', { name: '付款账户', exact: true })).toContainText('虚构备注现金');
    await expect(form.getByLabel('备注', { exact: true })).toHaveValue(text);
    previous = amount;
  }
  await page.screenshot({ path: `artifacts/note-recognition-${info.project.name}.png` });
  await form.getByRole('button', { name: '保存账目', exact: true }).click();
  await page.goto('./#/accounts');
  await expect(page.getByRole('button', { name: '虚构备注现金，余额 ¥ 992.00', exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.getByRole('button', { name: '虚构备注现金，余额 ¥ 992.00', exact: true })).toBeVisible();
});
test('餐饮用途结合备注时间推荐早餐，原文金额和日期确认后采用，保留已选资金账户', async ({ page }) => {
  const form = await setup(page);
  await form.getByLabel('金额', { exact: true }).fill('77.00');
  await form
    .getByLabel('备注', { exact: true })
    .fill('尾号1234卡2026年10月14日08:20支出(消费财付通-示例包點店)6.80元，余额2,345.67元。【工商银行】');
  await form.getByRole('button', { name: '识别备注', exact: true }).click();
  const panel = form.locator('.recognition-panel');
  await expect(panel).toContainText('金额 ¥ 6.80 · 支出');
  await expect(panel).toContainText('按备注时间 08:20 推荐早餐');
  await expect(panel.getByRole('button', { name: '早餐', exact: true })).toBeVisible();
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('77.00');
  await form.getByRole('button', { name: '采用并继续核对', exact: true }).click();
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('6.80');
  await expect(form.getByRole('button', { name: '当前分类：早餐', exact: true })).toBeVisible();
  await expect(form.getByRole('button', { name: '修改发生时间', exact: true })).toContainText(
    '2026-10-14 08:20',
  );
  await expect(form.getByRole('button', { name: '付款账户', exact: true })).toContainText('虚构备注现金');
});
test('多个金额只选实际交易，编辑备注使旧预览失效，无效金额及保留手动填写不覆盖草稿', async ({ page }) => {
  const form = await setup(page);
  await form.getByLabel('金额', { exact: true }).fill('42.00');
  await form.getByLabel('备注', { exact: true }).fill('早餐10元，午餐20元，余额90元');
  await form.getByRole('button', { name: '识别备注', exact: true }).click();
  const panel = form.locator('.recognition-panel');
  await expect(panel).toContainText('金额 未识别');
  await expect(panel).toContainText('余额 ¥ 90.00');
  const choice = panel.getByRole('button', { name: '20元 · ¥ 20.00', exact: true });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [320, 393, 1024]) {
      await page.setViewportSize({ width, height: 700 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await panel.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    }
  }
  await choice.click();
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  await expect(panel).toContainText('金额 ¥ 20.00');
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('42.00');
  await form.getByLabel('备注', { exact: true }).fill('停车费12块');
  await expect(panel).toHaveCount(0);
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('42.00');
  await form.getByRole('button', { name: '识别备注', exact: true }).click();
  await form.getByRole('button', { name: '保留手动填写', exact: true }).click();
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('42.00');
  await form.getByRole('button', { name: '识别备注', exact: true }).click();
  await form.getByRole('button', { name: '采用并继续核对', exact: true }).click();
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('12.00');
  await form.getByLabel('备注', { exact: true }).fill('停车费1.234元');
  await form.getByRole('button', { name: '识别备注', exact: true }).click();
  await expect(panel).toContainText('金额 未识别');
  await form.getByRole('button', { name: '采用并继续核对', exact: true }).click();
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('12.00');
  await form.getByLabel('备注', { exact: true }).fill('早餐10元，午餐20元');
  await form.getByRole('button', { name: '识别备注', exact: true }).click();
  await panel.getByRole('button', { name: '20元 · ¥ 20.00', exact: true }).click();
  await form.getByRole('button', { name: '采用并继续核对', exact: true }).click();
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('20.00');
});

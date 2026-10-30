import { expect, test, type Page } from '@playwright/test';
test.use({ reducedMotion: 'reduce' });
const password = 'fictional-opening-ui-password';
const sms = '尾号1234卡2026年9月1日08:09支出(消费虚构早餐店)12.34元，余额1,234.56元。【工商银行】';
async function initialize(page: Page) {
  await page.goto('./');
  await page.getByLabel('账本名称').fill('虚构起算时间体验账');
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByLabel('再次输入密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账本', exact: true }).click();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本', exact: true }).click();
}
async function createAccount(page: Page, bank = false) {
  if (new URL(page.url()).hash !== '#/accounts') await page.goto('./#/accounts');
  await page.getByRole('button', { name: '添加账户', exact: true }).click();
  await page
    .getByRole('dialog', { name: '选择账户类型' })
    .getByRole('button', {
      name: bank ? '储蓄卡 / 借记卡 工资卡、日常消费银行卡' : '现金 随身现金、备用金',
      exact: true,
    })
    .click();
  const form = page.getByRole('dialog', { name: '添加账户', exact: true });
  await form.getByLabel('账户名称').fill(bank ? '虚构储蓄卡' : '虚构现金');
  await form.getByLabel('账户里有多少钱（元）').fill('1000');
  await form.getByLabel('从什么时候开始记').fill('2026-10-15T10:30');
  if (bank) {
    await form.getByLabel('银行名称（选填）').fill('工商银行');
    await form.getByLabel('卡号后四位（选填）').fill('1234');
  }
  await form.getByRole('button', { name: '保存账户', exact: true }).click();
  await expect(form).toBeHidden();
}
async function editor(page: Page) {
  await page.goto('./#/');
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  return page.getByRole('dialog', { name: '记一笔', exact: true });
}
async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('BesLedger.encrypted.v1');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('vault'),
            read = tx.objectStore('vault').get('vault');
          read.onsuccess = () => resolve(JSON.stringify(read.result));
          tx.oncomplete = () => db.close();
        };
      }),
  );
}
async function setDate(page: Page, value = '2026-09-01T08:09') {
  await page.getByRole('button', { name: '修改发生时间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '发生时间', exact: true });
  await dialog.getByLabel('发生时间').fill(value);
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
}

test('账户起算快捷调整：短信日期推荐当天零点，取消不写入，确认刷新提示且保留草稿', async ({ page }, info) => {
  await initialize(page);
  await createAccount(page, true);
  const form = await editor(page);
  await form.getByLabel('备注').fill(sms);
  await form.getByRole('button', { name: '识别备注', exact: true }).click();
  await form.getByRole('button', { name: '采用并继续核对', exact: true }).click();
  await form.getByRole('button', { name: '早餐', exact: true }).click();
  const before = await stored(page);
  const historical = form.getByLabel('早于账户起算时间，本笔仅供历史查询，不改变期初之后的余额', {
    exact: true,
  });
  await expect(historical).not.toBeChecked();
  await form.getByRole('button', { name: '调整起算时间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '调整账户起算时间', exact: true });
  await expect(dialog).toContainText('虚构储蓄卡');
  await expect(dialog).toContainText('当前起算时间：2026-10-15 10:30');
  await expect(dialog.getByLabel('起算时间', { exact: true })).toHaveValue(/2026-10-15T10:30(?::00)?/);
  await expect(dialog.getByRole('button', { name: '确认调整', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '使用推荐时间：2026-09-01 00:00', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: '使用推荐时间：2026-09-01 00:00', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(await stored(page)).toBe(before);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [320, 393, 1024]) {
      await page.setViewportSize({ width, height: 640 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await dialog.locator('.modal-content').evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
        true,
      );
      await dialog.getByRole('button', { name: '确认调整', exact: true }).scrollIntoViewIfNeeded();
    }
  }
  await page.setViewportSize({ width: 393, height: 852 });
  await page.screenshot({ path: `artifacts/account-opening-dialog-${info.project.name}.png` });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(await stored(page)).toBe(before);
  await expect(historical).not.toBeChecked();
  await form.getByRole('button', { name: '调整起算时间', exact: true }).click();
  await dialog.getByRole('button', { name: '使用推荐时间：2026-09-01 00:00', exact: true }).click();
  await dialog.getByRole('button', { name: '确认调整', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(historical).toHaveCount(0);
  await expect(form.getByRole('status')).toContainText('起算时间已调整为 2026-09-01 00:00');
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('12.34');
  await expect(form.getByLabel('备注')).toHaveValue(sms);
  await expect(form.getByRole('button', { name: '当前分类：早餐', exact: true })).toBeVisible();
  await expect(form.getByRole('button', { name: '修改发生时间', exact: true })).toContainText(
    '2026-09-01 08:09',
  );
  await expect(form.getByRole('button', { name: '付款账户', exact: true })).toContainText('虚构储蓄卡');
  await page.screenshot({ path: `artifacts/account-opening-toast-${info.project.name}.png` });
  await form.getByRole('button', { name: '保存账目', exact: true }).click();
  await page.goto('./#/accounts');
  await expect(page.getByRole('button', { name: '虚构储蓄卡，余额 ¥ 987.66', exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.getByRole('button', { name: '虚构储蓄卡，余额 ¥ 987.66', exact: true })).toBeVisible();
});

test('账户起算手动调整：仍晚于账目时保留提示，精确到同一分钟后不误报早于起算', async ({ page }) => {
  await initialize(page);
  await createAccount(page);
  const form = await editor(page);
  await form.getByLabel('金额', { exact: true }).fill('9.00');
  await form.getByLabel('备注').fill('虚构手动调整时间');
  await form.getByRole('button', { name: '早餐', exact: true }).click();
  await form.getByRole('button', { name: '付款账户', exact: true }).click();
  await page
    .getByRole('dialog', { name: '选择资金账户', exact: true })
    .getByRole('button', { name: '虚构现金', exact: true })
    .click();
  await setDate(page);
  const historical = form.getByLabel('早于账户起算时间，本笔仅供历史查询，不改变期初之后的余额', {
    exact: true,
  });
  await historical.check();
  await form.getByRole('button', { name: '调整起算时间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '调整账户起算时间', exact: true });
  await dialog.getByLabel('起算时间', { exact: true }).fill('2026-09-01T09:00');
  await expect(dialog).toContainText('历史记录提示仍会保留');
  await dialog.getByRole('button', { name: '确认调整', exact: true }).click();
  await expect(historical).toBeVisible();
  await expect(historical).not.toBeChecked();
  await form.getByRole('button', { name: '调整起算时间', exact: true }).click();
  await dialog.getByLabel('起算时间', { exact: true }).fill('2026-09-01T08:09');
  await dialog.getByRole('button', { name: '确认调整', exact: true }).click();
  await expect(historical).toHaveCount(0);
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('9.00');
  await form.getByRole('button', { name: '保存账目', exact: true }).click();
  await page.goto('./#/accounts');
  await expect(page.getByRole('button', { name: '虚构现金，余额 ¥ 991.00', exact: true })).toBeVisible();
});

test('账户起算转账两端分别调整，另一账户仍晚于发生时间时提示继续保留', async ({ page }) => {
  await initialize(page);
  await createAccount(page);
  await createAccount(page, true);
  const form = await editor(page);
  await form.getByRole('button', { name: '转账', exact: true }).click();
  await form.getByLabel('金额', { exact: true }).fill('10.00');
  await form.getByLabel('备注').fill('虚构双端转账');
  await form.locator('.account-direction > button').first().click();
  await page
    .getByRole('dialog', { name: '选择资金账户', exact: true })
    .getByRole('button', { name: '虚构现金', exact: true })
    .click();
  await form.locator('.account-direction > button').last().click();
  await page
    .getByRole('dialog', { name: '选择资金账户', exact: true })
    .getByRole('button', { name: '虚构储蓄卡 尾号 1234', exact: true })
    .click();
  await setDate(page);
  await form.getByRole('button', { name: '调整「虚构现金」起算时间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '调整账户起算时间', exact: true });
  await dialog.getByRole('button', { name: '使用推荐时间：2026-09-01 00:00', exact: true }).click();
  await dialog.getByRole('button', { name: '确认调整', exact: true }).click();
  await expect(form.getByRole('button', { name: '调整起算时间', exact: true })).toBeVisible();
  await form.getByRole('button', { name: '调整起算时间', exact: true }).click();
  await expect(dialog).toContainText('虚构储蓄卡');
  await dialog.getByRole('button', { name: '使用推荐时间：2026-09-01 00:00', exact: true }).click();
  await dialog.getByRole('button', { name: '确认调整', exact: true }).click();
  await expect(form.locator('.opening-warning')).toHaveCount(0);
  await form.getByRole('button', { name: '保存账目', exact: true }).click();
  await page.goto('./#/accounts');
  await expect(page.getByRole('button', { name: '虚构现金，余额 ¥ 990.00', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '虚构储蓄卡，余额 ¥ 1,010.00', exact: true })).toBeVisible();
});

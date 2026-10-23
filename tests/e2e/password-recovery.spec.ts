import { expect, test, type Page } from '@playwright/test';

const oldPassword = 'fictional-browser-old-password';
const newPassword = 'fictional-browser-new-password';
async function initialize(page: Page) {
  await page.goto('./');
  await page.getByLabel('账本名称').fill('虚构口令恢复账本');
  await page.getByLabel('解锁密码', { exact: true }).fill(oldPassword);
  await page.getByRole('button', { name: '创建账本' }).click();
  const recovery = (await page.locator('.recovery-key').textContent())!.trim();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本' }).click();
  return recovery;
}
async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('BesLedger.encrypted.v1');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('vault');
          const read = tx.objectStore('vault').get('vault');
          read.onsuccess = () => resolve(JSON.stringify(read.result));
          tx.oncomplete = () => db.close();
        };
      }),
  );
}
async function lock(page: Page) {
  await page.goto('./#/settings');
  await page.getByRole('button', { name: '锁定', exact: true }).click();
  await expect(page.getByRole('button', { name: '忘记密码？' })).toBeVisible();
}
async function fillRecovery(page: Page, recovery: string, confirmation = newPassword) {
  await page.getByLabel('恢复密钥', { exact: true }).fill(recovery);
  await page.getByLabel('新的解锁密码', { exact: true }).fill(newPassword);
  await page.getByLabel('再次输入新密码', { exact: true }).fill(confirmation);
}

test('离线重设口令保留账户流水，错误与取消不改数据，刷新及重开使用新口令', async ({
  page,
  context,
}, info) => {
  const recovery = await initialize(page);
  await page.goto('./#/accounts');
  await page.getByRole('button', { name: '添加账户', exact: true }).click();
  await page
    .getByRole('dialog', { name: '选择账户类型' })
    .getByRole('button', { name: '现金 随身现金、备用金' })
    .click();
  const form = page.getByRole('dialog', { name: '添加账户', exact: true });
  await form.getByLabel('账户名称').fill('虚构恢复现金');
  await form.getByRole('button', { name: '保存账户' }).click();
  await page.goto('./#/');
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  const editor = page.getByRole('dialog', { name: '记一笔', exact: true });
  await editor.getByLabel('金额', { exact: true }).fill('8.50');
  await editor.getByRole('button', { name: '午餐', exact: true }).click();
  await editor.getByLabel('备注 · 粘贴银行短信即可识别').fill('虚构恢复测试午餐');
  await editor.getByRole('button', { name: '付款账户', exact: true }).click();
  await page
    .getByRole('dialog', { name: '选择资金账户' })
    .getByRole('button', { name: '虚构恢复现金' })
    .click();
  await editor.getByRole('button', { name: '保存账目' }).click();
  await expect(editor).toBeHidden();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await lock(page);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  const before = await stored(page);
  await page.getByRole('button', { name: '忘记密码？' }).click();
  await fillRecovery(page, '00'.repeat(32), 'fictional-mismatched-password');
  await page.getByRole('button', { name: '重设密码并打开', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('两次新密码不一致');
  expect((await stored(page)) === before, '不一致口令不修改存储').toBe(true);
  await fillRecovery(page, '00'.repeat(32));
  await page.getByRole('button', { name: '重设密码并打开', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('恢复密钥不正确');
  expect((await stored(page)) === before, '错误密钥不修改存储').toBe(true);
  await page.getByRole('button', { name: '返回解锁', exact: true }).click();
  await page.getByRole('button', { name: '忘记密码？' }).click();
  await expect(page.getByLabel('恢复密钥', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('新的解锁密码', { exact: true })).toHaveValue('');
  await fillRecovery(page, recovery);
  await expect(page.getByLabel('恢复密钥', { exact: true })).toHaveAttribute('type', 'password');
  await page.screenshot({ path: `artifacts/password-recovery-${info.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: '重设密码并打开', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('密码已重设');
  const after = JSON.parse(await stored(page));
  expect(JSON.parse(after.payload).data).toEqual(JSON.parse(JSON.parse(before).payload).data);
  expect(after.previous === after.payload, '回退检查点也使用新口令').toBe(true);
  await page.goto('./#/accounts');
  await expect(page.getByText('虚构恢复现金', { exact: true })).toBeVisible();
  await page.goto('./#/');
  await expect(page.getByRole('button').filter({ hasText: '虚构恢复测试午餐' })).toHaveCount(1);
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill(oldPassword);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('解锁密码', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.getByRole('button').filter({ hasText: '虚构恢复测试午餐' })).toHaveCount(1);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('./#/');
  await reopened.getByLabel('解锁密码', { exact: true }).fill(newPassword);
  await reopened.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(reopened.getByText('虚构口令恢复账本', { exact: true })).toBeVisible();
  await expect(reopened.getByRole('button').filter({ hasText: '虚构恢复测试午餐' })).toHaveCount(1);
});

test('深浅色与窄屏恢复表单不横向溢出，返回和 Esc 清除敏感输入', async ({ page }, info) => {
  await initialize(page);
  await lock(page);
  const before = await stored(page);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    for (const width of [320, 393, 1024]) {
      await page.setViewportSize({ width, height: 852 });
      await page.getByRole('button', { name: '忘记密码？' }).click();
      await fillRecovery(page, '00'.repeat(32));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: '返回解锁', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `artifacts/password-recovery-${info.project.name}-${width}-${colorScheme}.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: '返回解锁', exact: true }).click();
      await expect(page.getByLabel('解锁密码', { exact: true })).toHaveValue('');
      await page.getByRole('button', { name: '忘记密码？' }).click();
      await expect(page.getByLabel('恢复密钥', { exact: true })).toHaveValue('');
      await page.getByLabel('恢复密钥', { exact: true }).press('Escape');
      await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
      expect((await stored(page)) === before, '返回不修改存储').toBe(true);
    }
  }
});

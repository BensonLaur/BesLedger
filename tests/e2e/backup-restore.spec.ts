import { expect, test, type Page } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });
const password = 'fictional-backup-ui-password';
const restoredPassword = 'fictional-restored-ui-password';
async function initialize(page: Page) {
  await page.goto('./#/settings');
  await page.getByLabel('账本名称').fill('虚构备份体验账本');
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByLabel('再次输入密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账本', exact: true }).click();
  const recovery = (await page.locator('.recovery-key').textContent())!.trim();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的', exact: true })).toBeVisible();
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
            tx = db.transaction('vault'),
            read = tx.objectStore('vault').get('vault');
          read.onsuccess = () => resolve(JSON.stringify(read.result));
          tx.oncomplete = () => db.close();
        };
      }),
  );
}
async function openBackup(page: Page) {
  await page.getByRole('button', { name: '从备份找回账本', exact: false }).click();
}

test('锁定页备份恢复先校验、预览和确认，错误及取消不改数据，恢复后可离线重开', async ({
  page,
  context,
}, info) => {
  const recovery = await initialize(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整加密备份', exact: false }).click();
  const backupPath = (await (await downloading).path())!;
  await page.goto('./#/accounts');
  await page.getByRole('button', { name: '添加账户', exact: true }).click();
  await page
    .getByRole('dialog', { name: '选择账户类型' })
    .getByRole('button', { name: '现金 随身现金、备用金' })
    .click();
  await page
    .getByRole('dialog', { name: '添加账户', exact: true })
    .getByLabel('账户名称')
    .fill('虚构备份后新增账户');
  await page.getByRole('button', { name: '保存账户', exact: true }).click();
  await page.goto('./#/settings');
  await page.getByRole('button', { name: '锁定', exact: true }).click();
  const before = await stored(page);
  await openBackup(page);
  await page.getByLabel('加密备份文件').setInputFiles({
    name: 'fictional-invalid.besledger',
    mimeType: 'application/json',
    buffer: Buffer.from('invalid'),
  });
  await page.getByLabel('备份原密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '校验备份', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('无法读取这份备份');
  expect(await stored(page)).toBe(before);
  await page.getByLabel('加密备份文件').setInputFiles(backupPath);
  await page.getByLabel('备份原密码', { exact: true }).fill('fictional-wrong-password');
  await page.getByRole('button', { name: '校验备份', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请核对备份原密码');
  await expect(page.getByLabel('备份原密码', { exact: true })).toBeFocused();
  expect(await stored(page)).toBe(before);
  await page.getByLabel('备份原密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '校验备份', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('1 本账本、0 个账户、0 笔账目');
  expect(await stored(page)).toBe(before);
  await page.getByRole('button', { name: '返回解锁', exact: true }).click();
  expect(await stored(page)).toBe(before);
  await openBackup(page);
  await page.getByLabel('加密备份文件').setInputFiles(backupPath);
  await expect(page.getByLabel('备份原密码', { exact: true })).toHaveValue('');
  await page.getByLabel('使用恢复密钥', { exact: true }).check();
  await page.getByLabel('恢复密钥', { exact: true }).fill(recovery);
  await page.getByRole('button', { name: '校验备份', exact: true }).click();
  await page.getByLabel('新的解锁密码', { exact: true }).fill(restoredPassword);
  await page.getByLabel('再次输入新密码', { exact: true }).fill('fictional-mismatch-password');
  await page.getByRole('button', { name: '确认恢复备份', exact: true }).click();
  expect(await stored(page)).toBe(before);
  await page.getByLabel('我确认用这份备份替换当前全部本地账本').check();
  await page.getByRole('button', { name: '确认恢复备份', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('两次新密码不一致');
  expect(await stored(page)).toBe(before);
  await page.getByLabel('再次输入新密码', { exact: true }).fill(restoredPassword);
  for (const size of [
    { width: 320, height: 480 },
    { width: 393, height: 852 },
  ]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: '确认恢复备份', exact: true }).scrollIntoViewIfNeeded();
  }
  await page.screenshot({ path: `artifacts/restore-preview-${info.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: '确认恢复备份', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的', exact: true })).toBeVisible();
  await page.goto('./#/accounts');
  await expect(page.getByText('虚构备份后新增账户', { exact: true })).toHaveCount(0);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await context.setOffline(true);
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill(restoredPassword);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await page.goto('./#/');
  await expect(page.getByText('虚构备份体验账本', { exact: true })).toBeVisible();
});

test('我的页面更换备份凭证与重新打开会清除旧预览及替换同意', async ({ page }) => {
  await initialize(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整加密备份', exact: false }).click();
  const backupPath = (await (await downloading).path())!;
  const before = await stored(page);
  await page.getByRole('button', { name: '校验并恢复备份', exact: false }).click();
  const dialog = page.getByRole('dialog', { name: '恢复完整备份', exact: true });
  await dialog.getByLabel('加密备份文件').setInputFiles(backupPath);
  await dialog.getByLabel('备份原密码', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: '先校验备份', exact: true }).click();
  await dialog.getByLabel('恢复后的解锁密码', { exact: true }).fill(restoredPassword);
  await dialog.getByLabel('我确认用这份备份替换当前全部本地账本', { exact: false }).check();
  await dialog.getByLabel('备份原密码', { exact: true }).fill('fictional-changed-password');
  await expect(dialog.getByLabel('恢复后的解锁密码', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('备份原密码', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: '先校验备份', exact: true }).click();
  await expect(dialog.getByLabel('恢复后的解锁密码', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('我确认用这份备份替换当前全部本地账本', { exact: false })).not.toBeChecked();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  expect(await stored(page)).toBe(before);
  await page.getByRole('button', { name: '校验并恢复备份', exact: false }).click();
  await expect(dialog.getByLabel('备份原密码', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('恢复后的解锁密码', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('加密备份文件').setInputFiles(backupPath);
  await dialog.getByLabel('备份原密码', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: '先校验备份', exact: true }).click();
  await dialog.getByLabel('恢复后的解锁密码', { exact: true }).fill(restoredPassword);
  await dialog.getByLabel('我确认用这份备份替换当前全部本地账本', { exact: false }).check();
  await dialog.getByRole('button', { name: '恢复已验证备份', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: '锁定', exact: true }).click();
  await page.getByLabel('解锁密码', { exact: true }).fill(restoredPassword);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的', exact: true })).toBeVisible();
});

test('模拟主屏幕应用称呼，忘记密码说明密钥来源，无密钥可转备份并安心返回', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }),
  );
  await initialize(page);
  await page.getByRole('button', { name: '锁定', exact: true }).click();
  await expect(page.getByText('此应用中已保存账本。', { exact: false })).toBeVisible();
  await expect(page.getByText('账目在此应用中加密保存', { exact: true })).toBeVisible();
  const before = await stored(page);
  await page.getByRole('button', { name: '忘记密码？', exact: true }).click();
  await page.getByText('恢复密钥在哪里？', { exact: true }).click();
  await expect(
    page.getByText('请查找当时保存在密码管理器、纸张或其他安全位置的记录。', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('恢复密钥', { exact: true }).fill('incomplete');
  await page.getByLabel('新的解锁密码', { exact: true }).fill(restoredPassword);
  await page.getByLabel('再次输入新密码', { exact: true }).fill(restoredPassword);
  await page.getByRole('button', { name: '重设密码并打开', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('恢复密钥不完整');
  await expect(page.getByLabel('恢复密钥', { exact: true })).toBeFocused();
  expect(await stored(page)).toBe(before);
  await page.getByText('没保存恢复密钥怎么办？', { exact: true }).click();
  await page.getByRole('button', { name: '用备份找回账本', exact: false }).click();
  await expect(page.getByRole('heading', { name: '从备份恢复', exact: true })).toBeVisible();
  await expect(page.getByLabel('备份原密码', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '返回解锁', exact: true }).click();
  await expect(page.getByLabel('解锁密码', { exact: true })).toHaveValue('');
  expect(await stored(page)).toBe(before);
});

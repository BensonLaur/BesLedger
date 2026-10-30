import { expect, test, type Page } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });
const oldPassword = 'fictional-settings-old-password',
  newPassword = 'fictional-settings-new-password';
async function initialize(page: Page) {
  await page.goto('./#/settings');
  await page.getByLabel('账本名称').fill('虚构安全体验账本');
  await page.getByLabel('解锁密码', { exact: true }).fill(oldPassword);
  await page.getByLabel('再次输入密码', { exact: true }).fill(oldPassword);
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

test('我的修改密码与忘记密码衔接，错误及取消不改账目，离线重开接受新密码', async ({
  page,
  context,
}, info) => {
  const recovery = await initialize(page);
  const before = await stored(page);
  await expect(page.getByRole('heading', { name: '账本已打开' })).toBeVisible();
  await expect(
    page.locator('.settings-profile').getByText('账目在此浏览器中加密保存', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.connection-summary')).toContainText('通过 GitHub · 未登录');
  await page.getByRole('button', { name: '修改解锁密码', exact: false }).click();
  let dialog = page.getByRole('dialog', { name: '修改解锁密码', exact: true });
  await dialog.getByLabel('原解锁密码', { exact: true }).fill('fictional-wrong-password');
  await dialog.getByLabel('新的解锁密码', { exact: true }).fill(newPassword);
  await dialog.getByLabel('再次输入新密码', { exact: true }).fill('fictional-mismatch-password');
  await dialog.getByRole('button', { name: '保存新密码', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('两次新密码不一致');
  expect(await stored(page)).toBe(before);
  await dialog.getByLabel('再次输入新密码', { exact: true }).fill(newPassword);
  await dialog.getByRole('button', { name: '显示原解锁密码', exact: true }).click();
  await dialog.getByRole('button', { name: '保存新密码', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('原解锁密码不正确');
  await expect(dialog.getByLabel('原解锁密码', { exact: true })).toHaveAttribute('type', 'password');
  await expect(dialog.getByLabel('原解锁密码', { exact: true })).toBeFocused();
  expect(await stored(page)).toBe(before);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '修改解锁密码', exact: false }).click();
  await expect(dialog.getByLabel('原解锁密码', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: '忘记密码？', exact: true }).click();
  // 已打开账本时先说明并提供保存密钥的机会，不因误点立刻失去访问能力。
  await expect(dialog.getByRole('button', { name: '先查看与保存恢复密钥' })).toBeVisible();
  expect(await stored(page)).toBe(before);
  await dialog.getByRole('button', { name: '前往重设密码', exact: true }).click();
  await expect(page.getByRole('heading', { name: '重设解锁密码', exact: true })).toBeVisible();
  await expect(page.getByLabel('恢复密钥', { exact: true })).toHaveValue('');
  expect(await stored(page)).toBe(before);
  await page.getByRole('button', { name: '返回解锁', exact: true }).click();
  await page.getByLabel('解锁密码', { exact: true }).fill(oldPassword);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await context.setOffline(true);
  await page.getByRole('button', { name: '修改解锁密码', exact: false }).click();
  await dialog.getByLabel('原解锁密码', { exact: true }).fill(oldPassword);
  await dialog.getByLabel('新的解锁密码', { exact: true }).fill(newPassword);
  await dialog.getByLabel('再次输入新密码', { exact: true }).fill(newPassword);
  await dialog.getByRole('button', { name: '保存新密码', exact: true }).click();
  await expect(dialog).toBeHidden();
  const after = JSON.parse(await stored(page));
  expect(JSON.parse(after.payload).data).toEqual(JSON.parse(JSON.parse(before).payload).data);
  await page.getByRole('button', { name: '查看与保存恢复密钥', exact: false }).click();
  expect((await page.locator('.recovery-key').textContent())!.trim() === recovery).toBe(true);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill(oldPassword);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('未能打开账本');
  await page.getByLabel('解锁密码', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的', exact: true })).toBeVisible();
  await page.screenshot({ path: `artifacts/settings-security-${info.project.name}.png`, fullPage: true });
});

test('恢复密钥与首次保存共用复制反馈，主屏幕称呼一致，窄屏可操作且不横向溢出', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }),
  );
  await initialize(page);
  const before = await stored(page);
  await expect(
    page.locator('.settings-profile').getByText('账目在此应用中加密保存', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '查看与保存恢复密钥', exact: false }).click();
  const dialog = page.getByRole('dialog', { name: '查看与保存恢复密钥', exact: true });
  await expect(dialog).toContainText('点击“忘记密码？”');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('fictional-permission-denied');
        },
      },
    }),
  );
  await dialog.getByRole('button', { name: '复制恢复密钥', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('未能自动复制');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => undefined },
    }),
  );
  await dialog.getByRole('button', { name: '复制恢复密钥', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('已复制。请粘贴到密码管理器');
  await dialog.getByText('这份密钥适用于哪些账本？').click();
  await expect(dialog).toContainText('这是此应用中的恢复密钥');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [320, 393, 1024]) {
      await page.setViewportSize({ width, height: 640 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      await dialog.getByRole('button', { name: '完成', exact: true }).scrollIntoViewIfNeeded();
    }
  }
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '查看与保存恢复密钥', exact: false }).click();
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  expect(await stored(page)).toBe(before);
  await page.getByRole('button', { name: '锁定账本', exact: true }).last().click();
  await expect(page.getByText('此应用中已保存账本。', { exact: false })).toBeVisible();
});

test('我的恢复备份要求确认新密码，错误文件及凭证不写盘，匹配后才恢复', async ({ page }) => {
  await initialize(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出账本备份', exact: false }).click();
  const path = (await (await downloading).path())!;
  const before = await stored(page);
  await page.getByRole('button', { name: '从备份恢复账本', exact: false }).click();
  const dialog = page.getByRole('dialog', { name: '从备份恢复账本', exact: true });
  await dialog.getByLabel('加密备份文件').setInputFiles({
    name: 'fictional-bad.besledger',
    mimeType: 'application/json',
    buffer: Buffer.from('invalid'),
  });
  await dialog.getByLabel('备份原密码', { exact: true }).fill(oldPassword);
  await dialog.getByRole('button', { name: '校验备份', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('无法读取这份备份');
  expect(await stored(page)).toBe(before);
  await dialog.getByLabel('加密备份文件').setInputFiles(path);
  await dialog.getByLabel('备份原密码', { exact: true }).fill('fictional-wrong-password');
  await dialog.getByRole('button', { name: '校验备份', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('请核对备份原密码');
  expect(await stored(page)).toBe(before);
  await dialog.getByLabel('备份原密码', { exact: true }).fill(oldPassword);
  await dialog.getByRole('button', { name: '校验备份', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('1 本账本');
  await dialog.getByLabel('新的解锁密码', { exact: true }).fill(newPassword);
  await dialog.getByLabel('再次输入新密码', { exact: true }).fill('fictional-mismatch-password');
  await expect(dialog.getByRole('button', { name: '确认恢复备份', exact: true })).toBeDisabled();
  await dialog.getByLabel('我确认用这份备份替换当前全部本地账本').check();
  await dialog.getByRole('button', { name: '确认恢复备份', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('两次新密码不一致');
  expect(await stored(page)).toBe(before);
  await dialog.getByLabel('再次输入新密码', { exact: true }).fill(newPassword);
  await dialog.getByRole('button', { name: '确认恢复备份', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: '锁定账本', exact: true }).last().click();
  await page.getByLabel('解锁密码', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的', exact: true })).toBeVisible();
});

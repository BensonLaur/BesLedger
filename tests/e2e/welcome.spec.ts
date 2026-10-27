import { expect, test, type Page } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string | undefined>((resolve, reject) => {
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

test('首次确认密码与复制密钥，正常解锁页仅保留直接备份入口', async ({ page }, info) => {
  const password = 'fictional-welcome-password';
  await page.addInitScript(() => {
    const fixture = window as typeof window & { denyCopy?: boolean; copiedKey?: string };
    fixture.denyCopy = true;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (fixture.denyCopy) throw new Error('fixture denied');
          fixture.copiedKey = text;
        },
      },
    });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '开始记账', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '忘记密码？' })).toHaveCount(0);
  await expect(page.getByText('无需 GitHub 账号也能记账', { exact: false })).toBeHidden();
  await expect(page.getByLabel('解锁密码', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
  await expect(page.getByText('至少 10 个字符，可以用一句容易记住的话。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '从备份找回账本', exact: false })).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(
      await page
        .getByRole('button', { name: '创建账本', exact: true })
        .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 393, height: 852 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: `artifacts/welcome-create-${info.project.name}.png`, fullPage: true });
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '显示解锁密码', exact: true }).click();
  await expect(page.getByLabel('解锁密码', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '从备份找回账本', exact: false }).click();
  await expect(page.getByRole('button', { name: '返回开始', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回开始', exact: true }).click();
  await expect(page.getByLabel('解锁密码', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('解锁密码', { exact: true })).toHaveAttribute('type', 'password');
  await page.getByLabel('账本名称').fill('虚构首次体验账本');
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByLabel('再次输入密码', { exact: true }).fill('fictional-mismatched-password');
  await page.getByRole('button', { name: '创建账本', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('两次密码不一致');
  expect(await stored(page)).toBeUndefined();
  await page.getByLabel('再次输入密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账本', exact: true }).click();
  await expect(page.getByRole('heading', { name: '保存恢复密钥' })).toBeVisible();
  await expect(page.getByRole('button', { name: '进入账本', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '复制恢复密钥', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('未能自动复制');
  await expect(page.getByLabel('我已独立保存恢复密钥')).not.toBeChecked();
  await page.evaluate(() => {
    (window as typeof window & { denyCopy: boolean }).denyCopy = false;
  });
  await page.getByRole('button', { name: '复制恢复密钥', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已复制');
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { copiedKey: string }).copiedKey ===
        document.querySelector('.recovery-key')?.textContent,
    ),
  ).toBe(true);
  await expect(page.getByLabel('我已独立保存恢复密钥')).not.toBeChecked();
  await expect(page.getByRole('button', { name: '进入账本', exact: true })).toBeDisabled();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本', exact: true }).click();
  await page.goto('./#/settings');
  await page.getByRole('button', { name: '锁定', exact: true }).click();
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  await expect(page.getByText('此浏览器中已保存账本。', { exact: false })).toBeVisible();
  await expect(page.getByText('输入你设置的解锁密码，继续记账。', { exact: false })).toBeVisible();
  await expect(page.getByLabel('账本名称')).toHaveCount(0);
  await expect(page.getByText('至少 10 个字符，可以用一句容易记住的话。', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('解锁密码', { exact: true })).toHaveAttribute('placeholder', '请输入解锁密码');
  await expect(page.getByRole('button', { name: '账本打不开？', exact: false })).toBeHidden();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(
      await page
        .getByRole('button', { name: '打开账本', exact: true })
        .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 393, height: 852 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: `artifacts/welcome-unlock-${info.project.name}.png`, fullPage: true });
  const before = await stored(page);
  await expect(page.getByRole('button', { name: '查看本地备用副本', exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: '从备份找回账本', exact: false }).click();
  await expect(page.getByText('校验不会改动已有账本', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '返回解锁', exact: true }).click();
  expect((await stored(page)) === before, '取消备份恢复不应改动账本').toBe(true);
  await page.getByLabel('解锁密码', { exact: true }).fill('fictional-wrong-password');
  await page.getByRole('button', { name: '显示解锁密码', exact: true }).click();
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请检查解锁密码后重试');
  await expect(page.getByLabel('解锁密码', { exact: true })).toHaveAttribute('type', 'password');
  expect((await stored(page)) === before, '错误密码不应改动账本').toBe(true);
  await expect(page.getByRole('button', { name: '查看本地备用副本', exact: false })).toHaveCount(0);
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByLabel('解锁密码', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: '我的', exact: true })).toBeVisible();
  await page.goto('./#/');
  await expect(page.getByText('虚构首次体验账本', { exact: true })).toBeVisible();
});

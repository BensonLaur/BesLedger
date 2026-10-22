import { expect, test, type Page } from '@playwright/test';
import { fixtureApp } from '../fixtures';
import { githubSyncFixture } from '../support/github-sync-fixture';

const password = 'fictional-sync-browser-password';
async function initialize(page: Page, name: string) {
  await page.goto('./#/books');
  await page.getByLabel('账本名称').fill(name);
  await page.getByLabel('解锁口令', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建并继续' }).click();
  const recovery = await page.locator('.recovery-key').innerText();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本' }).click();
  await page.getByRole('button', { name: '使用 GitHub 登录' }).click();
  await expect(page.getByRole('button', { name: '退出 GitHub' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('已准备：fictional-user/BesLedger-Data', { exact: true })).toBeVisible();
  return recovery;
}
async function sync(page: Page) {
  if (new URL(page.url()).hash !== '#/books') await page.goto('./#/books');
  const button = page.getByRole('button', { name: '同步', exact: true });
  await expect(button).toBeEnabled();
  if (await page.getByRole('button', { name: '关闭提示', exact: true }).isVisible())
    await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await button.click();
  await expect(page.getByRole('status')).toContainText('同步成功');
}
test('模拟 GitHub：首次验证后自动记住同步密钥，页面切换/重启/锁定无需重复输入', async ({ browser }, info) => {
  test.setTimeout(90000);
  const remote = githubSyncFixture();
  const contexts = await Promise.all([0, 1].map(() => browser.newContext(info.project.use)));
  try {
    for (const context of contexts) {
      await context.route('https://api.github.com/**', async (route) => {
        const req = route.request();
        const reply = remote.handle(req.url(), req.method(), req.postData() ? req.postDataJSON() : undefined);
        await route.fulfill({ status: reply.status, json: reply.body });
      });
      await context.route('https://oauth-fixture.invalid/**', async (route) => {
        const device = new URL(route.request().url()).pathname === '/device';
        await route.fulfill({
          json: device
            ? {
                device_code: 'fictional-device',
                user_code: 'DEMO-CODE',
                verification_uri: 'https://github.com/login/device',
                expires_in: 900,
                interval: 5,
              }
            : { access_token: 'ghu_fictionalSyncKey', scope: '', app: fixtureApp },
        });
      });
    }
    const a = await contexts[0].newPage(),
      b = await contexts[1].newPage();
    const originalKey = await initialize(a, '虚构手机同步账');
    await a.getByRole('button', { name: '首次上传', exact: true }).click();
    await expect(a.getByText('同步密钥已在此设备加密保存', { exact: true })).toBeVisible();
    await initialize(b, '虚构电脑本地账');
    const input = b.getByLabel('原设备的同步恢复密钥（跨端下载时填写）');
    await input.fill('56'.repeat(32));
    await b.getByRole('button', { name: '解密并下载', exact: true }).click();
    await expect(b.getByRole('alert')).toContainText('密钥不匹配');
    await expect(b.getByText('同步密钥已在此设备加密保存', { exact: true })).toHaveCount(0);
    await input.fill(originalKey);
    await b.getByRole('button', { name: '解密并下载', exact: true }).click();
    await expect(b.getByText('同步密钥已在此设备加密保存', { exact: true })).toBeVisible();
    await expect(input).toHaveValue('');
    await b.goto('./#/settings');
    await sync(b);
    await b.reload();
    await b.getByLabel('解锁口令', { exact: true }).fill(password);
    await b.getByRole('button', { name: '解锁账本', exact: true }).click();
    await expect(b.getByRole('button', { name: '退出 GitHub', exact: true })).toBeVisible();
    await sync(b);
    await b.goto('./#/settings');
    await b.getByRole('button', { name: '锁定', exact: true }).click();
    await b.getByLabel('解锁口令', { exact: true }).fill(password);
    await b.getByRole('button', { name: '解锁账本', exact: true }).click();
    await expect(b.getByRole('button', { name: '退出 GitHub', exact: true })).toBeVisible();
    await sync(b);
    // 错误的替换输入必须失败，留空后仍能用原先已验证的密钥同步。
    await input.fill('78'.repeat(32));
    await b.getByRole('button', { name: '同步', exact: true }).click();
    await expect(b.getByRole('alert')).toContainText('密钥不匹配');
    await input.fill('');
    await sync(b);
    const card = b
      .locator('.book-card')
      .filter({ has: b.locator('.book-name', { hasText: '虚构手机同步账' }) });
    await card.getByRole('button', { name: '改名', exact: true }).click();
    await b.getByRole('dialog', { name: '账本改名' }).getByLabel('账本名称').fill('虚构电脑修改已回传');
    await b
      .getByRole('dialog', { name: '账本改名' })
      .getByRole('button', { name: '保存', exact: true })
      .click();
    await sync(b);
    await sync(a);
    await expect(a.locator('.book-name')).toContainText('虚构电脑修改已回传');
    const archive = await b.evaluate(
      () =>
        new Promise<any>((resolve, reject) => {
          const q = indexedDB.open('BesLedger.encrypted.v1');
          q.onerror = () => reject(new Error('fixture database unavailable'));
          q.onsuccess = () => {
            const db = q.result,
              t = db.transaction('vault', 'readonly'),
              r = t.objectStore('vault').get('vault');
            r.onsuccess = () => resolve(JSON.parse(r.result.payload));
            t.oncomplete = () => db.close();
          };
        }),
    );
    expect(Object.keys(archive.deviceSyncKeys)).toHaveLength(1);
    expect(JSON.stringify(archive).includes(originalKey)).toBe(false);
    for (const f of remote.files.values())
      expect(Buffer.from(f.content, 'base64').toString().includes(originalKey)).toBe(false);
    await b.getByRole('button', { name: '同步密钥', exact: true }).click();
    await b.getByRole('button', { name: '忘记此设备密钥', exact: true }).click();
    await expect(b.getByText('同步密钥已在此设备加密保存', { exact: true })).toHaveCount(0);
    await expect(b.locator('.book-name').filter({ hasText: '虚构电脑修改已回传' })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

import { expect, type Page, type BrowserContext } from '@playwright/test';
import { fixtureApp } from '../fixtures';
import { githubSyncFixture } from './github-sync-fixture';
export const password = 'fictional-sync-ui-password';
export async function mockSync(context: BrowserContext, remote: ReturnType<typeof githubSyncFixture>) {
  await context.route('https://api.github.com/**', async (route) => {
    const request = route.request();
    const reply = remote.handle(
      request.url(),
      request.method(),
      request.postData() ? request.postDataJSON() : undefined,
    );
    await route.fulfill({ status: reply.status, json: reply.body });
  });
  await context.route('https://oauth-fixture.invalid/**', async (route) => {
    await route.fulfill({
      json:
        new URL(route.request().url()).pathname === '/device'
          ? {
              device_code: 'fictional-device',
              user_code: 'DEMO-CODE',
              verification_uri: 'https://github.com/login/device',
              expires_in: 900,
              interval: 5,
            }
          : { access_token: 'ghu_fictionalSyncUi', scope: '', app: fixtureApp },
    });
  });
}
export async function createVault(page: Page, name: string) {
  await page.goto('./#/books');
  await page.getByLabel('账本名称').fill(name);
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByLabel('再次输入密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账本', exact: true }).click();
  const key = (await page.locator('.recovery-key').textContent())!.trim();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本', exact: true }).click();
  return key;
}
export async function login(page: Page) {
  await page.getByRole('button', { name: '使用 GitHub 登录', exact: true }).click();
  await expect(page.locator('.connection-summary')).toContainText('已登录', { timeout: 15000 });
  await expect(page.getByText('连接已就绪，选择要同步的账本。', { exact: true })).toBeVisible();
}
export function card(page: Page, name: string) {
  return page.locator('.book-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
}
export async function upload(page: Page, name: string) {
  await card(page, name).getByRole('button', { name: '首次上传', exact: true }).click();
  await page.getByLabel('我已保存取回这本账需要的恢复密钥').check();
  await page.getByRole('button', { name: '确认首次上传', exact: true }).click();
  await expect(card(page, name).getByText('上次同步成功', { exact: true })).toBeVisible();
}
export async function download(page: Page, key: string) {
  await page.getByRole('button', { name: '预览并下载', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '取回这本账', exact: true });
  await dialog.getByLabel('原设备的恢复密钥', { exact: true }).fill(key);
  await dialog.getByRole('button', { name: '验证并预览', exact: true }).click();
  await dialog.getByRole('button', { name: '确认添加账本', exact: true }).click();
  await expect(dialog).toBeHidden();
}
export async function sync(page: Page, name: string) {
  if (new URL(page.url()).hash !== '#/books') await page.goto('./#/books');
  await expect(page.getByText('连接已就绪，选择要同步的账本。', { exact: true })).toBeVisible();
  const id = await card(page, name).getAttribute('data-book-id');
  await card(page, name).getByRole('button', { name: '同步', exact: true }).click();
  await expect(
    page.locator(`[data-book-id="${id}"]`).getByText('上次同步成功', { exact: true }),
  ).toBeVisible();
}
export async function rename(page: Page, oldName: string, name: string) {
  await page.getByRole('button', { name: `${oldName}的更多操作`, exact: true }).click();
  await page.getByRole('button', { name: '账本改名', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '账本改名', exact: true });
  await dialog.getByLabel('账本名称').fill(name);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toBeHidden();
}
export async function keyManager(page: Page, name: string) {
  await page.getByRole('button', { name: `${name}的更多操作`, exact: true }).click();
  await page.getByRole('button', { name: '同步密钥', exact: true }).click();
}
export async function stored(page: Page) {
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
export async function reopen(page: Page) {
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.getByText('连接已就绪，选择要同步的账本。', { exact: true })).toBeVisible();
}

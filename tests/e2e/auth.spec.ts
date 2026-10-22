import { expect, test, type Page } from '@playwright/test';
import { fixtureApp, fixtureInstallation, fixtureRepository } from '../fixtures';

async function connection(page: Page) {
  await expect(page.locator('.app-shell')).toBeVisible();
  const summary = page.locator('.connection-summary');
  if ((await summary.count()) && (await summary.getAttribute('aria-expanded')) === 'false')
    await summary.click();
}
const password = 'fictional-browser-auth-password';
async function unlock(page: Page) {
  await page.getByLabel('解锁口令', { exact: true }).fill(password);
  await page.getByRole('button', { name: '解锁账本', exact: true }).click();
  await connection(page);
  await expect(page.getByRole('button', { name: '退出 GitHub', exact: true })).toBeVisible();
}

test('模拟 GitHub App 响应：加密登录跨刷新/关闭重开/锁定保留，跨窗口退出不复活', async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  let grants = 0,
    renewals = 0,
    rejectApi = false,
    revoke = false;
  await context.route('https://oauth-fixture.invalid/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/device') {
      grants++;
      return route.fulfill({
        json: {
          device_code: 'fictional-device-code',
          user_code: 'DEMO-CODE',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        },
      });
    }
    if (path === '/refresh') {
      renewals++;
      return route.fulfill({
        json: revoke
          ? { error: 'bad_refresh_token' }
          : {
              access_token: 'ghu_fictionalRenewed',
              refresh_token: 'fictional-renewed-refresh',
              scope: '',
              app: fixtureApp,
              expires_in: 28800,
              refresh_token_expires_in: 15552000,
            },
      });
    }
    return route.fulfill({
      json: {
        access_token: 'ghu_fictionalBrowser',
        refresh_token: 'fictional-browser-refresh',
        scope: '',
        app: fixtureApp,
        expires_in: 28800,
        refresh_token_expires_in: 15552000,
      },
    });
  });
  await context.route('https://api.github.com/**', async (route) => {
    if (rejectApi && route.request().headers().authorization !== 'Bearer ghu_fictionalRenewed')
      return route.fulfill({ status: 401, json: {} });
    const path = new URL(route.request().url()).pathname;
    if (path === '/user/installations')
      return route.fulfill({
        json: { installations: [{ ...fixtureInstallation, repository_selection: 'all' }] },
      });
    if (path === '/user/installations/11/repositories') return route.fulfill({ json: { repositories: [] } });
    if (path === '/repos/fictional-user/BesLedger-Data')
      return route.fulfill({
        json: {
          ...fixtureRepository,
          name: 'BesLedger-Data',
          full_name: 'fictional-user/BesLedger-Data',
          owner: { id: 42, login: 'fictional-user' },
        },
      });
    if (path.endsWith('/contents/besledger/repository.json'))
      return route.fulfill({
        json: {
          encoding: 'base64',
          size: 120,
          content: Buffer.from(
            JSON.stringify({
              format: 'BesLedger.repository',
              version: 1,
              repositoryId: fixtureRepository.id,
              ownerId: 42,
            }),
          ).toString('base64'),
        },
      });
    return route.fulfill({
      json: new URL(route.request().url()).pathname === '/user' ? { id: 42, login: 'fictional-user' } : [],
    });
  });
  if (new URL(page.url()).hash !== '#/settings') await page.goto('./#/settings');
  await page.getByLabel('账本名称').fill('虚构登录验收账本');
  await page.getByLabel('解锁口令', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建并继续' }).click();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本' }).click();
  await connection(page);
  await page.getByRole('button', { name: '使用 GitHub 登录' }).click();
  await expect(page.getByText('DEMO-CODE', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '退出 GitHub', exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText('云端私有存储已准备好，选择要同步的账本即可')).toBeVisible();
  await context.setOffline(true);
  if (new URL(page.url()).hash !== '#/settings') await page.goto('./#/settings');
  await expect(page.locator('.connection-summary')).toContainText('已保存登录 · 暂时离线');
  await expect(page.locator('.connection-details')).toHaveCount(0);
  await connection(page);
  await expect(page.getByRole('button', { name: '退出 GitHub', exact: true })).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await unlock(page);
  if (new URL(page.url()).hash !== '#/settings') await page.goto('./#/settings');
  if (await page.getByRole('dialog', { name: 'GitHub 连接' }).count())
    await page
      .getByRole('dialog', { name: 'GitHub 连接' })
      .getByRole('button', { name: '关闭', exact: true })
      .click();
  await page.getByRole('button', { name: '锁定', exact: true }).click();
  await unlock(page);
  // 页面关闭后新建页面，保留真实 IndexedDB；不使用测试变量模拟登录恢复。
  const reopened = await context.newPage();
  await page.close();
  if (new URL(reopened.url()).hash !== '#/settings') await reopened.goto('./#/settings');
  await unlock(reopened);
  expect(grants).toBe(1);
  await reopened.getByRole('link', { name: '管理云端账本' }).click();
  rejectApi = true;
  await reopened.getByRole('button', { name: '重新检查云端存储' }).click();
  await expect.poll(() => renewals).toBe(1);
  if (new URL(reopened.url()).hash !== '#/settings') await reopened.goto('./#/settings');
  await connection(reopened);
  const other = await context.newPage();
  if (new URL(other.url()).hash !== '#/settings') await other.goto('./#/settings');
  await unlock(other);
  await reopened.getByRole('button', { name: '退出 GitHub', exact: true }).click();
  await expect(other.getByRole('button', { name: '使用 GitHub 登录' })).toBeVisible();
  await other.reload();
  await other.getByLabel('解锁口令', { exact: true }).fill(password);
  await other.getByRole('button', { name: '解锁账本', exact: true }).click();
  await connection(other);
  await expect(other.getByRole('button', { name: '使用 GitHub 登录' })).toBeVisible();
  expect(grants).toBe(1);
  rejectApi = false;
  await other.getByRole('button', { name: '使用 GitHub 登录' }).click();
  await expect(other.getByRole('button', { name: '退出 GitHub', exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(other.getByText('云端私有存储已准备好，选择要同步的账本即可')).toBeVisible();
  if (new URL(other.url()).hash !== '#/settings') await other.goto('./#/settings');
  await connection(other);
  rejectApi = true;
  revoke = true;
  // 进入账本页会自动检查存储，失效授权无需额外点击就应被识别。
  await other.getByRole('link', { name: '管理云端账本' }).click();
  await expect(other.getByRole('button', { name: '使用 GitHub 登录' })).toBeVisible();
  await expect(other.getByRole('status')).toContainText('GitHub 授权已失效，请重新登录；本地账目不受影响');
  expect(grants).toBe(2);
});

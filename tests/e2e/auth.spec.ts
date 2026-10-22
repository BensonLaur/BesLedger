import { expect, test, type Page } from '@playwright/test';

const password = 'fictional-browser-auth-password';
async function unlock(page: Page) {
  await page.getByLabel('解锁口令', { exact: true }).fill(password);
  await page.getByRole('button', { name: '解锁账本', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出 GitHub', exact: true })).toBeVisible();
}

test('模拟 OAuth 响应：加密登录跨刷新/关闭重开/锁定保留，跨窗口退出不复活', async ({ page, context }) => {
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
              access_token: 'fictional-renewed-access',
              refresh_token: 'fictional-renewed-refresh',
              scope: 'repo',
              expires_in: 28800,
              refresh_token_expires_in: 15552000,
            },
      });
    }
    return route.fulfill({
      json: {
        access_token: 'fictional-browser-access',
        refresh_token: 'fictional-browser-refresh',
        scope: 'repo',
        expires_in: 28800,
        refresh_token_expires_in: 15552000,
      },
    });
  });
  await context.route('https://api.github.com/**', async (route) => {
    if (rejectApi && route.request().headers().authorization !== 'Bearer fictional-renewed-access')
      return route.fulfill({ status: 401, json: {} });
    return route.fulfill({
      json: new URL(route.request().url()).pathname === '/user' ? { id: 42, login: 'fictional-user' } : [],
    });
  });
  await page.goto('./#/settings');
  await page.getByLabel('账本名称').fill('虚构登录验收账本');
  await page.getByLabel('解锁口令', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建并继续' }).click();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本' }).click();
  await page.getByRole('button', { name: '使用 GitHub 登录' }).click();
  await expect(page.getByText('DEMO-CODE', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '退出 GitHub', exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.reload();
  await unlock(page);
  await page.getByRole('button', { name: '锁定', exact: true }).click();
  await unlock(page);
  // 页面关闭后新建页面，保留真实 IndexedDB；不使用测试变量模拟登录恢复。
  const reopened = await context.newPage();
  await page.close();
  await reopened.goto('./#/settings');
  await unlock(reopened);
  expect(grants).toBe(1);
  await reopened.getByRole('link', { name: '管理云端账本' }).click();
  rejectApi = true;
  await reopened.getByRole('button', { name: '读取我的私有仓库' }).click();
  await expect.poll(() => renewals).toBe(1);
  await reopened.goto('./#/settings');
  const other = await context.newPage();
  await other.goto('./#/settings');
  await unlock(other);
  await reopened.getByRole('button', { name: '退出 GitHub', exact: true }).click();
  await expect(other.getByRole('button', { name: '使用 GitHub 登录' })).toBeVisible();
  await other.reload();
  await other.getByLabel('解锁口令', { exact: true }).fill(password);
  await other.getByRole('button', { name: '解锁账本', exact: true }).click();
  await expect(other.getByRole('button', { name: '使用 GitHub 登录' })).toBeVisible();
  expect(grants).toBe(1);
  rejectApi = false;
  await other.getByRole('button', { name: '使用 GitHub 登录' }).click();
  await expect(other.getByRole('button', { name: '退出 GitHub', exact: true })).toBeVisible({
    timeout: 15000,
  });
  rejectApi = true;
  revoke = true;
  await other.getByRole('link', { name: '管理云端账本' }).click();
  await other.getByRole('button', { name: '读取我的私有仓库' }).click();
  await expect(other.getByRole('button', { name: '使用 GitHub 登录' })).toBeVisible();
  await expect(other.getByText('GitHub 授权已失效，请重新登录；本地账目不受影响')).toBeVisible();
  expect(grants).toBe(2);
});

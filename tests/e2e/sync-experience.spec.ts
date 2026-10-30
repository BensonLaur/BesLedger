import { expect, test } from '@playwright/test';
import { githubSyncFixture } from '../support/github-sync-fixture';
import {
  card,
  createVault,
  download,
  login,
  mockSync,
  password,
  rename,
  reopen,
  stored,
  sync,
  upload,
} from '../support/sync-ui';

test('新设备无需空账：分步开启同步，预览取消和错误密钥不写账目，云端变化须重新预览', async ({
  browser,
}, info) => {
  test.setTimeout(120000);
  const remote = githubSyncFixture(),
    contexts = await Promise.all([0, 1].map(() => browser.newContext(info.project.use)));
  try {
    for (const context of contexts) await mockSync(context, remote);
    const a = await contexts[0].newPage(),
      b = await contexts[1].newPage();
    const originalKey = await createVault(a, '虚构原设备账本');
    await login(a);
    await card(a, '虚构原设备账本').getByRole('button', { name: '首次上传', exact: true }).click();
    await expect(a.getByRole('button', { name: '确认首次上传', exact: true })).toBeDisabled();
    await a.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    expect(remote.files.size).toBe(0);
    await upload(a, '虚构原设备账本');
    await b.goto('./');
    await b.getByRole('button', { name: '从其他设备取回账本', exact: false }).click();
    await expect(b.getByLabel('账本名称')).toHaveCount(0);
    await b.getByLabel('解锁密码', { exact: true }).fill(password);
    await b.getByLabel('再次输入密码', { exact: true }).fill(password);
    await b.getByRole('button', { name: '设置密码并继续', exact: true }).click();
    const newKey = (await b.locator('.recovery-key').textContent())!.trim();
    expect(newKey === originalKey).toBe(false);
    await b.getByLabel('我已独立保存恢复密钥').check();
    await b.getByRole('button', { name: '继续取回账本', exact: true }).click();
    await expect(b.getByRole('heading', { name: '账本管理', exact: true })).toBeVisible();
    await expect(b.locator('.book-card')).toHaveCount(0);
    await b.getByRole('button', { name: '首次开启同步', exact: true }).click();
    await expect(b.getByText('第 1 步：在 GitHub 开启同步权限', { exact: true })).toBeVisible();
    await expect(b.getByText('默认选择 All repositories', { exact: false })).toBeVisible();
    await contexts[1].route('https://github.com/apps/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<p>Fictional authorization page, no permissions granted.</p>',
      }),
    );
    const opened = contexts[1].waitForEvent('page');
    await b.getByRole('button', { name: '前往 GitHub 开启权限', exact: true }).click();
    const authorization = await opened;
    await authorization.close();
    await expect(b.getByText('第 2 步：返回这里完成登录', { exact: true })).toBeVisible();
    await expect(b.getByRole('button', { name: '使用 GitHub 登录', exact: true })).toBeVisible();
    await login(b);
    const before = await stored(b);
    await b.getByRole('button', { name: '预览并下载', exact: true }).click();
    const dialog = b.getByRole('dialog', { name: '取回这本账', exact: true });
    await dialog.getByLabel('原设备的恢复密钥', { exact: true }).fill(newKey);
    await dialog.getByRole('button', { name: '验证并预览', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('恢复密钥不正确');
    expect(await stored(b)).toBe(before);
    await dialog.getByLabel('原设备的恢复密钥', { exact: true }).fill(originalKey);
    await dialog.getByRole('button', { name: '验证并预览', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('虚构原设备账本');
    for (const width of [320, 393, 1024]) {
      await b.setViewportSize({ width, height: 640 });
      expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await dialog.locator('.modal-content').evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
        true,
      );
      await dialog.getByRole('button', { name: '确认添加账本', exact: true }).scrollIntoViewIfNeeded();
    }

    expect(await stored(b)).toBe(before);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect(await stored(b)).toBe(before);
    await b.getByRole('button', { name: '预览并下载', exact: true }).click();
    await expect(dialog.getByLabel('原设备的恢复密钥', { exact: true })).toHaveValue('');
    await dialog.getByLabel('原设备的恢复密钥', { exact: true }).fill(originalKey);
    await dialog.getByRole('button', { name: '验证并预览', exact: true }).click();
    await rename(a, '虚构原设备账本', '虚构云端更新后的账本');
    await sync(a, '虚构云端更新后的账本');
    await dialog.getByRole('button', { name: '确认添加账本', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('云端账本已更新');
    expect(await stored(b)).toBe(before);
    await dialog.getByRole('button', { name: '验证并预览', exact: true }).click();
    await dialog.getByRole('button', { name: '确认添加账本', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(card(b, '虚构云端更新后的账本')).toBeVisible();
    await expect(b.locator('.book-card')).toHaveCount(1);
    await b.evaluate(() => window.scrollTo(0, 0));
    await b.screenshot({ path: `artifacts/sync-books-${info.project.name}.png`, fullPage: true });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('差异按生活语言核对，稍后处理与选择跨切页重启保留，离线可核对，移除前检查云端', async ({
  browser,
}, info) => {
  test.setTimeout(120000);
  const remote = githubSyncFixture(),
    contexts = await Promise.all([0, 1].map(() => browser.newContext(info.project.use)));
  try {
    for (const context of contexts) await mockSync(context, remote);
    const a = await contexts[0].newPage(),
      b = await contexts[1].newPage();
    const key = await createVault(a, '虚构共同账本');
    await login(a);
    await upload(a, '虚构共同账本');
    await createVault(b, '虚构独立本地账');
    await login(b);
    await download(b, key);
    await rename(a, '虚构共同账本', '虚构甲设备改名');
    await rename(b, '虚构共同账本', '虚构乙设备改名');
    await sync(a, '虚构甲设备改名');
    await card(b, '虚构乙设备改名').getByRole('button', { name: '同步', exact: true }).click();
    let review = b.getByRole('dialog', { name: '虚构乙设备改名 · 核对差异', exact: true });
    await expect(review).toBeVisible();
    await expect(review.locator('pre')).toHaveCount(0);
    await expect(review).toContainText('虚构甲设备改名');
    await expect(review).toContainText('虚构乙设备改名');
    await expect(review.getByRole('button', { name: '确认选择并保存', exact: true })).toBeDisabled();
    await review.getByRole('button', { name: '稍后处理', exact: true }).click();
    await b.goto('./#/settings');
    await b.goto('./#/books');
    await reopen(b);
    await expect(card(b, '虚构乙设备改名').getByText('1 项差异待核对', { exact: true })).toBeVisible();
    await card(b, '虚构乙设备改名').getByRole('button', { name: '核对差异', exact: true }).click();
    await review.getByRole('button', { name: '保留云端的内容', exact: true }).click();
    await review.getByRole('button', { name: '稍后处理', exact: true }).click();
    await reopen(b);
    await contexts[1].setOffline(true);
    await card(b, '虚构乙设备改名').getByRole('button', { name: '核对差异', exact: true }).click();
    await expect(review.getByRole('button', { name: '已选择：云端的内容', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await b.evaluate(() => window.scrollTo(0, 0));
    await b.screenshot({ path: `artifacts/sync-review-${info.project.name}.png`, fullPage: true });
    await review.getByRole('button', { name: '确认选择并保存', exact: true }).click();
    await expect(card(b, '虚构甲设备改名').getByText('有更新待同步', { exact: true })).toBeVisible();
    await expect(card(b, '虚构甲设备改名').getByRole('button', { name: '同步', exact: true })).toBeDisabled();
    await expect(card(b, '虚构独立本地账')).toBeVisible();
    await contexts[1].setOffline(false);
    await sync(b, '虚构甲设备改名');
    await b.getByRole('button', { name: '虚构甲设备改名的更多操作', exact: true }).click();
    await b.getByRole('button', { name: '仅移除这里的副本', exact: true }).click();
    const removing = b.getByRole('dialog', { name: '仅移除这里的副本', exact: true });
    await expect(removing).toContainText('虚构甲设备改名');
    await sync(a, '虚构甲设备改名');
    await rename(a, '虚构甲设备改名', '虚构移除前云端又更新');
    await sync(a, '虚构移除前云端又更新');
    const beforeRemove = await stored(b);
    await removing.getByRole('button', { name: '确认移除这里的副本', exact: true }).click();
    await expect(removing).toContainText('云端内容有变化');
    expect(await stored(b)).toBe(beforeRemove);
    await removing.getByRole('button', { name: '关闭', exact: true }).click();
    await sync(b, '虚构甲设备改名');
    await b.getByRole('button', { name: '虚构移除前云端又更新的更多操作', exact: true }).click();
    await b.getByRole('button', { name: '仅移除这里的副本', exact: true }).click();
    await removing.getByRole('button', { name: '确认移除这里的副本', exact: true }).click();
    await expect(removing).toBeHidden();
    await expect(card(b, '虚构独立本地账')).toBeVisible();
    expect(remote.files.size).toBe(1);
    await b.getByRole('button', { name: '预览并下载', exact: true }).click();
    const transfer = b.getByRole('dialog', { name: '取回这本账', exact: true });
    await expect(transfer.getByLabel('原设备的恢复密钥', { exact: true })).toHaveCount(0);
    await transfer.getByRole('button', { name: '验证并预览', exact: true }).click();
    await transfer.getByRole('button', { name: '确认添加账本', exact: true }).click();
    await expect(card(b, '虚构移除前云端又更新')).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

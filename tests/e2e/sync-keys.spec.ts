import { expect, test } from '@playwright/test';
import { githubSyncFixture } from '../support/github-sync-fixture';
import {
  mockSync,
  createVault,
  login,
  upload,
  download,
  sync,
  rename,
  keyManager,
  stored,
  reopen,
  card,
  password,
} from '../support/sync-ui';

test('模拟 GitHub：账本并存、密钥保持及错误替换不改数据，改名与同步使用同一身份', async ({
  browser,
}, info) => {
  test.setTimeout(120000);
  const remote = githubSyncFixture();
  const contexts = await Promise.all([0, 1].map(() => browser.newContext(info.project.use)));
  try {
    for (const context of contexts) await mockSync(context, remote);
    const a = await contexts[0].newPage(),
      b = await contexts[1].newPage();
    const originalKey = await createVault(a, '虚构手机同步账');
    await login(a);
    await upload(a, '虚构手机同步账');
    await createVault(b, '虚构电脑本地账');
    await b.goto('./#/accounts');
    await b.getByRole('button', { name: '添加账户', exact: true }).click();
    await b
      .getByRole('dialog', { name: '选择账户类型' })
      .getByRole('button', { name: '现金 随身现金、备用金' })
      .click();
    const account = b.getByRole('dialog', { name: '添加账户', exact: true });
    await account.getByLabel('账户名称').fill('虚构仅本地现金');
    await account.getByLabel('账户里有多少钱（元）').fill('1000');
    await account.getByLabel('从什么时候开始记').fill('2026-01-01T00:00');
    await account.getByRole('button', { name: '保存账户' }).click();
    await expect(account).toBeHidden();
    await b.goto('./#/');
    await b.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
    const editor = b.getByRole('dialog', { name: '记一笔', exact: true });
    await editor.getByLabel('金额', { exact: true }).fill('9.87');
    await editor.getByRole('button', { name: '早餐', exact: true }).click();
    await editor.getByLabel('备注').fill('虚构仅本地流水');
    await editor.getByRole('button', { name: '付款账户', exact: true }).click();
    await b
      .getByRole('dialog', { name: '选择资金账户' })
      .getByRole('button', { name: '虚构仅本地现金' })
      .click();
    await editor.getByRole('button', { name: '保存账目' }).click();
    await expect(editor).toBeHidden();
    await b.goto('./#/books');
    await login(b);
    await expect(card(b, '虚构电脑本地账').getByText('只在这里保存', { exact: true })).toBeVisible();
    expect(remote.files.size).toBe(1);
    await download(b, originalKey);
    const savedBefore = JSON.parse(JSON.parse(await stored(b)).payload).deviceSyncKeys;
    await sync(b, '虚构手机同步账');
    await reopen(b);
    await sync(b, '虚构手机同步账');
    await b.goto('./#/settings');
    await b.getByRole('button', { name: '锁定账本', exact: true }).last().click();
    await b.getByLabel('解锁密码', { exact: true }).fill(password);
    await b.getByRole('button', { name: '打开账本', exact: true }).click();
    await sync(b, '虚构手机同步账');
    await keyManager(b, '虚构手机同步账');
    await b.getByRole('button', { name: '更换恢复密钥并同步', exact: true }).click();
    await b.getByLabel('原设备的恢复密钥', { exact: true }).fill('78'.repeat(32));
    await b.getByRole('button', { name: '验证并同步', exact: true }).click();
    await expect(b.getByRole('dialog').getByRole('alert')).toContainText('恢复密钥不正确');
    expect(JSON.parse(JSON.parse(await stored(b)).payload).deviceSyncKeys).toEqual(savedBefore);
    await b.getByRole('button', { name: '取消', exact: true }).click();
    await sync(b, '虚构手机同步账');
    await rename(b, '虚构手机同步账', '虚构电脑修改已回传');
    await sync(b, '虚构电脑修改已回传');
    await sync(a, '虚构手机同步账');
    await expect(card(a, '虚构电脑修改已回传')).toBeVisible();
    const archive = JSON.parse(JSON.parse(await stored(b)).payload);
    expect(Object.keys(archive.deviceSyncKeys)).toHaveLength(1);
    expect(JSON.stringify(archive).includes(originalKey)).toBe(false);
    for (const file of remote.files.values())
      expect(Buffer.from(file.content, 'base64').toString().includes(originalKey)).toBe(false);
    await keyManager(b, '虚构电脑修改已回传');
    await b.getByRole('button', { name: '忘记这里保存的密钥', exact: true }).click();
    await expect(card(b, '虚构电脑修改已回传')).toBeVisible();
    expect(Object.keys(JSON.parse(JSON.parse(await stored(b)).payload).deviceSyncKeys || {})).toHaveLength(0);
    await card(b, '虚构电脑本地账').getByRole('button', { name: '进入账本', exact: true }).click();
    await expect(b.getByRole('button').filter({ hasText: '虚构仅本地流水' })).toContainText('9.87');
    await b.goto('./#/accounts');
    await expect(b.getByRole('button', { name: /余额 ¥ 990[.]13/ })).toBeVisible();
    await b.goto('./#/books');
    expect(remote.files.size).toBe(1);
    await upload(b, '虚构电脑本地账');
    expect(remote.files.size).toBe(2);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

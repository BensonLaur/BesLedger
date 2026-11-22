import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import type { StoredVault } from '../../src/storage/backend';
let modules: ViteDevServer;
let rows: Record<'single' | 'many' | 'empty', StoredVault>;
test.beforeAll(async () => {
  modules = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const { accountPickerFixture } = await modules.ssrLoadModule('/tests/support/account-picker-fixture.ts');
  rows = {
    single: await accountPickerFixture('single'),
    many: await accountPickerFixture('many'),
    empty: await accountPickerFixture('empty'),
  };
});
test.afterAll(async () => {
  await modules?.close();
});
async function open(page: Page, mode: keyof typeof rows = 'single') {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('./');
  await expect(page.getByRole('button', { name: '创建账本', exact: true })).toBeVisible();
  await page.evaluate(async (row) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('BesLedger.encrypted.v1');
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction('vault', 'readwrite');
        tx.objectStore('vault').put(row);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }, rows[mode]);
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill('fictional-picker-password');
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  return page.getByRole('dialog', { name: '记一笔', exact: true });
}
const picker = (page: Page) => page.locator('.account-picker-backdrop').getByRole('dialog');

test('单账户紧凑显示银行尾号与余额，付款/收款标题清楚，勾选立即返回且未保存不写账', async ({ page }) => {
  const editor = await open(page);
  await editor.getByRole('button', { name: '付款账户', exact: true }).click();
  const dialog = picker(page);
  await expect(dialog).toHaveAttribute('aria-label', '选择付款账户');
  const account = dialog.getByRole('button', { name: '日常储蓄卡', exact: true });
  await expect(account).toContainText('示例银行');
  await expect(account).toContainText('尾号 1234');
  await expect(account).toContainText('1,000.00');
  await expect(dialog.getByLabel('搜索账户')).toHaveCount(0);
  expect((await dialog.boundingBox())!.height).toBeLessThan(230);
  await account.click();
  await expect(dialog).toBeHidden();
  await expect(editor.getByRole('button', { name: '付款账户', exact: true })).toContainText('日常储蓄卡');
  await editor.getByRole('button', { name: '付款账户', exact: true }).click();
  await expect(account).toHaveAttribute('aria-pressed', 'true');
  await expect(account.locator('.account-picker-check svg')).toBeVisible();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await editor.getByRole('button', { name: '收入', exact: true }).click();
  await editor.getByRole('button', { name: '收款账户', exact: true }).click();
  await expect(dialog).toHaveAttribute('aria-label', '选择收款账户');
  await account.click();
  await editor.getByRole('button', { name: '返回', exact: true }).click();
  await page.goto('./#/accounts');
  await expect(page.locator('.assets-total')).toContainText('1,000.00');
});

test('多账户按类型与最近使用查找，跨账本余额正确，长名称和底部添加入口不溢出', async ({ page }) => {
  const editor = await open(page, 'many');
  await page.setViewportSize({ width: 320, height: 640 });
  await editor.getByRole('button', { name: '付款账户', exact: true }).click();
  const dialog = picker(page);
  await expect(dialog.getByRole('heading', { name: '最近使用', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '日常储蓄卡', exact: true })).toContainText('987.66');
  const search = dialog.getByLabel('搜索账户');
  await search.fill('1234');
  await expect(dialog.locator('.account-picker-row')).toHaveCount(1);
  await search.fill('示例银行');
  await expect(dialog.locator('.account-picker-row')).toHaveCount(1);
  await search.fill('信用卡');
  const debt = dialog.getByRole('button', { name: '日常信用卡', exact: true });
  const extra = dialog.getByRole('button', { name: '有余款的信用卡', exact: true });
  await expect(debt).toContainText('420.00');
  await expect(debt).toContainText('待还款');
  await expect(extra).toContainText('卡内余款');
  await expect(extra).toContainText('120.00');
  await search.fill('不存在的虚构账户');
  await expect(dialog).toContainText('没有找到这个账户');
  await search.fill('微信');
  await expect(
    dialog.getByRole('button', { name: '旅行与家用的微信零钱长名称账户', exact: true }),
  ).toBeVisible();
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  const add = await dialog.getByRole('button', { name: '添加账户', exact: true }).boundingBox();
  expect(add!.y + add!.height).toBeLessThanOrEqual(641);
});

test('隐藏金额与账户页共用，切页刷新保持，选择器文字及辅助说明不泄露余额', async ({ page }) => {
  const editor = await open(page, 'many');
  await editor.getByRole('button', { name: '付款账户', exact: true }).click();
  const dialog = picker(page);
  await dialog.getByRole('button', { name: '隐藏金额', exact: true }).click();
  await expect(dialog.locator('.account-picker-value').first()).toContainText('••••••');
  await expect(dialog).not.toContainText('987.66');
  await expect(dialog).not.toContainText('420.00');
  await dialog.getByRole('button', { name: '日常储蓄卡', exact: true }).click();
  await editor.getByRole('button', { name: '返回', exact: true }).click();
  await page.goto('./#/accounts');
  await expect(page.locator('.assets-total')).toContainText('••••••');
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill('fictional-picker-password');
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.locator('.assets-total')).toContainText('••••••');
  await page.getByRole('button', { name: '显示金额', exact: true }).click();
  await page.goto('./#/');
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  await editor.getByRole('button', { name: '付款账户', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '日常储蓄卡', exact: true })).toContainText('987.66');
});

test('转账方向和借贷往来方标题明确，保留原有账户范围及关闭后草稿', async ({ page }) => {
  const editor = await open(page, 'many');
  await editor.getByRole('button', { name: '转账', exact: true }).first().click();
  await editor.locator('.account-direction > button').first().click();
  const dialog = picker(page);
  await expect(dialog).toHaveAttribute('aria-label', '从哪个账户转出');
  await dialog.getByRole('button', { name: '日常储蓄卡', exact: true }).click();
  await editor.locator('.account-direction > button').last().click();
  await expect(dialog).toHaveAttribute('aria-label', '转入哪个账户');
  await dialog.getByRole('button', { name: '随身现金', exact: true }).click();
  await editor.getByRole('button', { name: '借贷', exact: true }).click();
  await editor.getByRole('button', { name: '借出', exact: true }).click();
  await editor.locator('.account-direction > button').last().click();
  await expect(dialog).toHaveAttribute('aria-label', '选择往来方');
  await expect(dialog.locator('.account-picker-row')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: '朋友甲', exact: true })).toContainText('我欠别人');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(editor).toBeVisible();
});

test('空账户可添加或取消，不丢金额备注，添加后可回到选择器选择', async ({ page }) => {
  const editor = await open(page, 'empty');
  await editor.getByLabel('金额', { exact: true }).fill('12.34');
  await editor.getByLabel('备注', { exact: true }).fill('虚构手动备注');
  await editor.getByRole('button', { name: '完成备注', exact: true }).click();
  await editor.getByRole('button', { name: '付款账户', exact: true }).click();
  const dialog = picker(page);
  await expect(dialog).toContainText('还没有资金账户');
  await dialog.getByRole('button', { name: '添加账户', exact: true }).click();
  const types = page.getByRole('dialog', { name: '选择账户类型', exact: true });
  await types.getByRole('button', { name: '返回', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '添加账户', exact: true }).click();
  await types.getByRole('button', { name: '现金 随身现金、备用金', exact: true }).click();
  const form = page.getByRole('dialog', { name: '添加账户', exact: true });
  await form.getByLabel('账户名称').fill('虚构新现金');
  await form.getByLabel('账户里有多少钱（元）').fill('100');
  await form.getByRole('button', { name: '保存账户', exact: true }).click();
  await dialog.getByRole('button', { name: '虚构新现金', exact: true }).click();
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('12.34');
  await expect(editor.getByLabel('备注', { exact: true })).toHaveValue('虚构手动备注');
});

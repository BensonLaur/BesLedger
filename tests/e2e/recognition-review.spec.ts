import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import type { StoredVault } from '../../src/storage/backend';
import { setEntryTime } from '../support/entry-time-ui';
let modules: ViteDevServer, row: StoredVault;
test.use({ reducedMotion: 'reduce' });
test.beforeAll(async () => {
  modules = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const { accountPickerFixture } = await modules.ssrLoadModule('/tests/support/account-picker-fixture.ts');
  row = await accountPickerFixture('single');
});
test.afterAll(async () => {
  await modules?.close();
});
async function open(page: Page) {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.clock.setFixedTime(new Date('2026-11-22T23:00:00+08:00'));
  await page.goto('./');
  await expect(page.getByRole('button', { name: '创建账本', exact: true })).toBeVisible();
  await page.evaluate(async (row) => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('BesLedger.encrypted.v1');
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction('vault', 'readwrite');
        tx.objectStore('vault').put(row);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      r.onerror = () => reject(r.error);
    });
  }, row);
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill('fictional-picker-password');
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  return page.getByRole('dialog', { name: '记一笔', exact: true });
}
const review = (page: Page) => page.getByRole('dialog', { name: '备注识别结果', exact: true });
async function recognize(page: Page, note: string) {
  await page.getByLabel('备注', { exact: true }).fill(note);
  await page.getByRole('button', { name: '识别备注', exact: true }).click();
  return review(page);
}
async function bank(page: Page) {
  await page.getByRole('button', { name: '付款账户', exact: true }).click();
  await page
    .locator('.account-picker-backdrop')
    .getByRole('button', { name: '日常储蓄卡', exact: true })
    .click();
}

test('缺分类与推断年份突出，详情默认收起；直接补齐后保存，不把短信余额写到账户', async ({ page }) => {
  const editor = await open(page);
  const dialog = await recognize(
    page,
    '尾号1234卡11月22日17:37支出(消费虚构商户)15元，余额1,200.00元。【示例银行】',
  );
  await expect(dialog.getByLabel('本次金额')).toHaveValue('15.00');
  await expect(dialog.locator('.review-task-heading')).toContainText('2 项');
  await expect(dialog.locator('.review-field.pending')).toHaveCount(2);
  await expect(dialog.getByText('年份待确认', { exact: true })).toBeVisible();
  await expect(dialog.locator('.review-details')).not.toHaveAttribute('open', '');
  await expect(dialog.getByText(/备注中的余额 ¥/)).toBeHidden();
  expect((await dialog.boundingBox())!.height).toBeLessThan(560);
  await dialog.locator('.review-fields').getByRole('button', { name: '选择分类', exact: true }).click();
  await dialog.getByLabel('搜索分类').fill('停车费');
  await dialog.getByRole('button', { name: '停车费', exact: true }).click();
  await dialog.getByRole('button', { name: '确认 2026 年', exact: true }).click();
  await dialog.getByRole('button', { name: '采用并返回', exact: true }).click();
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('15.00');
  await expect(editor.getByRole('button', { name: '当前分类：停车费', exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: '修改发生时间', exact: true })).toContainText('17:37');
  await editor.getByRole('button', { name: '保存账目', exact: true }).click();
  await expect(editor).toBeHidden();
  await page.goto('./#/accounts');
  await expect(page.locator('.assets-total')).toContainText('985.00');
});

test('候选和日期修改先留在核对面板，关闭或保留填写不改原草稿', async ({ page }) => {
  const editor = await open(page);
  await bank(page);
  await editor.getByLabel('金额', { exact: true }).fill('77.00');
  await editor.getByRole('button', { name: '午餐', exact: true }).click();
  const beforeTime = await editor.getByRole('button', { name: '修改发生时间', exact: true }).innerText();
  const dialog = await recognize(page, '早餐10元，午餐20元');
  await dialog.getByRole('button', { name: '20元 · ¥ 20.00', exact: true }).click();
  await dialog.getByRole('button', { name: '早餐', exact: true }).click();
  await dialog.getByRole('button', { name: '修改时间', exact: true }).click();
  const time = page.getByRole('dialog', { name: '发生时间', exact: true });
  await setEntryTime(time, '2025-10-02T08:20');
  await time.getByRole('button', { name: '确定', exact: true }).click();
  await expect(dialog.getByLabel('本次金额')).toHaveValue('20.00');
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('77.00');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('77.00');
  await expect(editor.getByRole('button', { name: '当前分类：午餐', exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: '修改发生时间', exact: true })).toHaveText(beforeTime);
  await page.locator('.recognition-summary').click();
  await expect(dialog.getByLabel('本次金额')).toHaveValue('77.00');
  await dialog.getByRole('button', { name: '保留我的填写', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('自动模式突出实际保留的手填金额和分类，来源折叠，确认其余字段不覆盖它们', async ({ page }) => {
  const editor = await open(page);
  await bank(page);
  await editor.getByLabel('金额', { exact: true }).fill('77.00');
  await editor.getByRole('button', { name: '早餐', exact: true }).click();
  await editor.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  await editor
    .getByLabel('备注', { exact: true })
    .fill('尾号1234卡11月22日17:37支出(消费虚构商户)15元。【示例银行】');
  await expect(page.locator('.recognition-summary')).toBeVisible();
  await editor.getByRole('button', { name: '完成备注', exact: true }).click();
  await page.locator('.recognition-summary').click();
  const dialog = review(page);
  await expect(dialog.getByLabel('本次金额')).toHaveValue('77.00');
  await expect(dialog).toContainText('保留手填金额');
  await expect(dialog.locator('.review-fields')).toContainText('保留手动选择');
  await expect(dialog.locator('.review-details').getByText(/识别金额 ¥ 15.00/)).toBeHidden();
  await dialog.getByRole('button', { name: '完成核对', exact: true }).click();
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('77.00');
  await expect(editor.getByRole('button', { name: '当前分类：早餐', exact: true })).toBeVisible();
});

test('缺账户可直接打开选择器，关键交易风险始终可见', async ({ page }) => {
  const editor = await open(page);
  let dialog = await recognize(page, '停车费10元');
  await dialog.locator('.review-actions').getByRole('button', { name: '选择账户', exact: true }).click();
  await page
    .locator('.account-picker-backdrop')
    .getByRole('button', { name: '日常储蓄卡', exact: true })
    .click();
  await dialog.getByRole('button', { name: '采用并返回', exact: true }).click();
  for (const [text, warning] of [
    ['停车费10美元', '当前仅支持人民币'],
    ['计划花10元吃午餐', '未完成的交易'],
    ['退款20元', '退款需选择原支出'],
  ]) {
    dialog = await recognize(page, text);
    await expect(dialog.locator('.review-critical').filter({ hasText: warning })).toBeVisible();
    await dialog.getByRole('button', { name: '保留我的填写', exact: true }).click();
    await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('10.00');
    await expect(editor.getByRole('button', { name: '支出', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
});

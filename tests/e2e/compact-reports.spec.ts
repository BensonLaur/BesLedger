import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import type { StoredVault } from '../../src/storage/backend';
let modules: ViteDevServer;
let compactFixture: (negative?: boolean) => Promise<StoredVault>;
test.beforeAll(async () => {
  modules = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ compactFixture } = await modules.ssrLoadModule('/tests/support/compact-fixture.ts'));
});
test.afterAll(async () => {
  await modules?.close();
});

async function open(page: Page, negative = false) {
  const row = await compactFixture(negative);
  await page.clock.setFixedTime(new Date('2026-11-22T12:00:00+08:00'));
  await page.goto('./');
  await expect(page.getByRole('button', { name: '创建账本', exact: true })).toBeVisible();
  await page.evaluate(async (row: StoredVault) => {
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
  }, row);
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill('fictional-compact-password');
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.locator('.home-columns')).toBeVisible();
}

test('账户分组同时展示数量和汇总，信用卡余款不抵消待还，展开偏好与隐私生效', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await open(page);
  await page.goto('./#/accounts');
  const credit = page.locator('.account-group-heading').filter({ hasText: '信用卡' });
  await expect(credit).toContainText('(2)');
  await expect(credit).toContainText('待还 452.00 · 余款 120.00');
  await expect(credit).toHaveAttribute('aria-expanded', 'false');
  const last = await page.locator('.account-group-heading').last().boundingBox();
  const navigation = await page.locator('.bottom-nav').boundingBox();
  expect(last!.y + last!.height).toBeLessThan(navigation!.y);
  await credit.click();
  await expect(page.getByRole('button', { name: /日常信用卡，待还款/ })).toBeVisible();
  await page.goto('./#/events');
  await page.goto('./#/accounts');
  await expect(credit).toHaveAttribute('aria-expanded', 'true');
  const hero = await page.locator('.assets-hero').boundingBox();
  expect(hero!.height).toBeLessThan(180);
  await page.getByRole('button', { name: '隐藏金额', exact: true }).click();
  await expect(credit).not.toContainText('452.00');
  await expect(page.locator('.assets-total')).toContainText('••••••');
  await page.getByRole('button', { name: '余额说明', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '余额说明' })).toContainText('多个账本间共用');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('趋势点选、分类下钻、明细返回、月年和自选范围保持同一收支口径', async ({ page }) => {
  await open(page);
  await page.goto('./#/statistics');
  await expect(page.locator('[data-point]')).toHaveCount(30);
  await page.locator('[data-point="2026-11-05"]').click();
  await expect(page.locator('.statistic-point')).toContainText('2026-11-05');
  await expect(page.locator('.statistic-point')).toContainText('63.00');
  await page.getByRole('button', { name: '查看明细', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '统计明细' })).toContainText('3 笔');
  await page
    .getByRole('dialog', { name: '统计明细' })
    .getByRole('button', { name: '返回', exact: true })
    .click();
  await expect(page.locator('.statistic-point')).toContainText('2026-11-05');
  await page.getByRole('button', { name: '大类', exact: true }).click();
  await expect(page.locator('.donut-svg')).toBeVisible();
  await page.locator('.statistic-rank-row').filter({ hasText: '餐饮' }).click();
  await expect(page.locator('.statistic-major')).toContainText('餐饮');
  await expect(page.locator('.statistic-rank-row').filter({ hasText: '午餐' })).toBeVisible();
  await page.locator('.statistic-rank-row').filter({ hasText: '早餐' }).click();
  await expect(page.getByRole('dialog', { name: '统计明细' })).toContainText('20 笔');
  await page
    .getByRole('dialog', { name: '统计明细' })
    .getByRole('button', { name: '返回', exact: true })
    .click();
  await page.getByRole('button', { name: '趋势', exact: true }).click();
  await page.getByRole('button', { name: '查看收入', exact: true }).click();
  await expect(page.locator('.statistic-card')).toContainText('6,000.00');
  await page.getByRole('button', { name: '查看净支出', exact: true }).click();
  await page.getByRole('button', { name: '上一个统计周期' }).click();
  await expect(page.getByLabel('统计月份')).toHaveValue('2026-10');
  await page.getByRole('button', { name: '下一个统计周期' }).click();
  await page.getByRole('button', { name: '年', exact: true }).click();
  await expect(page.locator('[data-point]')).toHaveCount(12);
  await page.getByLabel('统计年份').fill('0000');
  await page.getByLabel('统计年份').dispatchEvent('change');
  await expect(page.getByLabel('统计年份')).toHaveValue('2026');
  await page.getByRole('button', { name: '上一个统计周期' }).click();
  await expect(page.getByLabel('统计年份')).toHaveValue('2025');
  await expect(page.locator('.statistic-empty')).toBeVisible();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  const dates = page.getByRole('dialog', { name: '选择时间范围' });
  await dates.getByLabel('开始日期').fill('2026-11-02');
  await dates.getByLabel('结束日期').fill('2026-11-01');
  await dates.getByRole('button', { name: '查看统计', exact: true }).click();
  await expect(dates.getByRole('alert')).toContainText('有效');
  await dates.getByLabel('结束日期').fill('2026-11-03');
  await dates.getByRole('button', { name: '查看统计', exact: true }).click();
  await expect(page.locator('[data-point]')).toHaveCount(2);
  await expect(page.locator('.statistic-range')).toContainText('2026-11-02 至 2026-11-03');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.getByLabel('统计账户').selectOption('cash');
  await page.getByRole('button', { name: '筛选 · 已启用', exact: true }).click();
  await expect(page.locator('.report-filter-summary')).toContainText('随身现金');
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.locator('.report-filter-summary')).toHaveCount(0);
});

test('退款负数和结余使用正负条形图，小屏与安全区不遮挡内容', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await open(page, true);
  await page.goto('./#/statistics');
  await page.getByRole('button', { name: '小类', exact: true }).click();
  await expect(page.locator('.donut-svg')).toHaveCount(0);
  await expect(page.locator('.statistic-explanation')).toContainText('含负数');
  await page.getByRole('button', { name: /^展开全部/ }).click();
  await page.locator('.statistic-rank-row').filter({ hasText: '加油' }).click();
  await expect(page.getByRole('dialog', { name: '统计明细' })).toContainText('-500.00');
  await page
    .getByRole('dialog', { name: '统计明细' })
    .getByRole('button', { name: '返回', exact: true })
    .click();
  await page.getByRole('button', { name: '查看收支结余', exact: true }).click();
  await expect(page.locator('.donut-svg')).toHaveCount(0);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '28px');
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px');
  });
  expect(
    await page.locator('.page-heading').evaluate((e) => e.getBoundingClientRect().top),
  ).toBeGreaterThanOrEqual(28);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

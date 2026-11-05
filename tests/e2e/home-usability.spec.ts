import { expect, test, type Page } from '@playwright/test';
import { Vault } from '../../src/storage/vault';
import { put } from '../../src/domain/model';
import type { Backend } from '../../src/storage/backend';

async function initialize(page: Page, count = 0) {
  let row: Awaited<ReturnType<Backend['read']>>;
  const vault = new Vault({
    read: async () => row,
    compareSwap: async (expected, payload) => {
      if ((row?.revision ?? 0) !== expected) throw Error('CAS');
      row = { id: 'vault', revision: expected + 1, payload };
      return expected + 1;
    },
  });
  await vault.create('fictional-home-review');
  await vault.mutate((s) => {
    put(s, { kind: 'ledger', name: '虚构首页验收' }, 'home-review');
    s.preferences.currentLedger = 'home-review';
    if (!count) return;
    put(
      s,
      {
        kind: 'account',
        name: '虚构现金',
        type: 'cash',
        opening: 100000,
        openedAt: '2026-01-01T00:00:00',
        bank: '',
        tail: '',
      },
      'home-cash',
    );
    for (let i = 0; i < count; i++)
      put(s, {
        kind: 'entry',
        ledgerId: 'home-review',
        type: 'expense',
        amount: 100,
        interest: 0,
        from: 'home-cash',
        to: '',
        categoryId: 'expense.food.001',
        at: '2026-11-06T08:00:00',
        note: `虚构早餐 ${i}`,
        behavior: '',
        createdAt: '2026-11-06T08:00:00',
      });
  });
  vault.lock();
  await page.clock.setFixedTime(new Date('2026-11-06T15:00:00+08:00'));
  await page.goto('./');
  await expect(page.getByRole('button', { name: '创建账本', exact: true })).toBeVisible();
  await page.evaluate(async (value) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('BesLedger.encrypted.v1');
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('vault', 'readwrite');
        tx.objectStore('vault').put({ ...value, id: 'vault' });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }, row!);
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill('fictional-home-review');
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.locator('.home-columns')).toBeVisible();
}

test('首次首页先添加账户，空日历可展开且不妨碍下一步', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await initialize(page);
  await expect(page.getByText('先添加常用的资金账户')).toBeVisible();
  await expect(page.locator('.calendar-grid')).toHaveCount(0);
  await page.getByRole('button', { name: '展开日历', exact: true }).click();
  await expect(page.locator('.calendar-grid')).toBeVisible();
  await expect(page.getByRole('button', { name: '2026-11-06 暂无记录', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '添加账户', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '选择账户类型' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('日期摘要与明细跳转，分批列表保留整日小计和完整金额', async ({ page }) => {
  await initialize(page, 120);
  await expect(page.locator('.entry-row')).toHaveCount(50);
  await expect(page.locator('.day-group .section-heading')).toContainText('支 120.00');
  await page.getByRole('button', { name: '加载更多账目', exact: true }).click();
  await expect(page.locator('.entry-row')).toHaveCount(100);
  await page.getByRole('button', { name: '加载更多账目', exact: true }).click();
  await expect(page.locator('.entry-row')).toHaveCount(120);
  await page.getByRole('button', { name: '2026-11-06 净支出 120.00元', exact: true }).click();
  await expect(page.locator('.selected-day-summary')).toContainText('已记 120 笔');
  await expect(page.locator('.entry-row')).toHaveCount(50);
  await page.getByRole('button', { name: '查看当天明细', exact: true }).click();
  await expect(page.getByRole('region', { name: '账目明细' })).toBeFocused();
  await page.getByRole('button', { name: '取消日期选择', exact: true }).click();
  await expect(page.locator('.selected-day-summary')).toHaveCount(0);
  await page.getByLabel('查看月份').fill('');
  await page.getByLabel('查看月份').dispatchEvent('change');
  await expect(page.getByLabel('查看月份')).toHaveValue('2026-11');
  await expect(page.locator('.hero-amount')).toContainText('120.00');
});

test('筛选收起仍显示条件，无结果可清除，长文字不溢出且未写账', async ({ page }) => {
  await initialize(page, 2);
  const before = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('BesLedger.encrypted.v1');
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise<string>((resolve) => {
      const r = db.transaction('vault').objectStore('vault').get('vault');
      r.onsuccess = () => {
        db.close();
        resolve(JSON.stringify(r.result));
      };
    });
  });
  await page.getByRole('button', { name: '搜索与筛选', exact: true }).click();
  await page.getByLabel('关键词搜索').fill('这是一段不存在的很长的虚构备注'.repeat(8));
  await page.getByRole('button', { name: '搜索与筛选', exact: true }).click();
  await expect(page.getByRole('button', { name: '搜索与筛选', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByLabel('已启用的筛选')).toBeVisible();
  await expect(page.getByRole('heading', { name: '没有找到符合条件的账目' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '全部清除', exact: true }).click();
  await expect(page.locator('.entry-row')).toHaveCount(2);
  const after = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('BesLedger.encrypted.v1');
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise<string>((resolve) => {
      const r = db.transaction('vault').objectStore('vault').get('vault');
      r.onsuccess = () => {
        db.close();
        resolve(JSON.stringify(r.result));
      };
    });
  });
  expect(after).toBe(before);
});

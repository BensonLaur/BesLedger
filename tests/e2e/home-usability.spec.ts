import { expect, test, type Locator, type Page } from '@playwright/test';
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
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  await page.getByLabel('解锁密码', { exact: true }).fill('fictional-home-review');
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.locator('.home-columns')).toBeVisible();
}

test('账目左滑只展开快捷入口，支持编辑、复制及取消或确认删除', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 680 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await initialize(page, 10);
  const row = (index: number) =>
    page.locator('.entry-swipe-row').filter({ has: page.getByText(`虚构早餐 ${index}`, { exact: true }) });
  const toggle = (item: Locator) => item.getByRole('button', { name: '账目操作', exact: true });
  const actions = (item: Locator) => item.getByRole('group', { name: '快捷操作', exact: true });
  const detail = page.getByRole('dialog', { name: '账目详情', exact: true });
  const touch = info.project.name === 'android-layout' ? await page.context().newCDPSession(page) : null;
  async function drag(item: Locator, dx: number, dy = 0) {
    const content = item.locator('.entry-row');
    // 把目标行放到屏幕中间，避免手势从覆盖页面的固定底栏起步。
    await item.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const box = (await content.boundingBox())!;
    const x = Math.round(box.x + box.width * (dx < 0 ? 0.8 : 0.75));
    const y = Math.round(box.y + box.height / 2);
    if (touch) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let step = 1; step <= 5; step++)
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: Math.round(x + (dx * step) / 5), y: Math.round(y + (dy * step) / 5) }],
        });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 5 });
      await page.mouse.up();
    }
  }

  const first = page.locator('.entry-swipe-row').first();
  await drag(first, 3, -110);
  await expect(page.getByRole('group', { name: '快捷操作', exact: true })).toHaveCount(0);
  await expect(detail).toHaveCount(0);
  if (touch) {
    // 触屏惯性滚动结束后再开始下一次手势，否则该次触摸只会停止滚动。
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const before = scrollY;
          await new Promise((resolve) => setTimeout(resolve, 180));
          return scrollY === before;
        }),
      )
      .toBe(true);
  }
  await drag(row(0), -125);
  await expect(actions(row(0)).getByRole('button')).toHaveText(['编辑', '复制', '删除']);
  await expect(detail).toHaveCount(0);
  await drag(row(0), 82);
  await expect(toggle(row(0))).toHaveAttribute('aria-expanded', 'false');

  await toggle(row(0)).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(actions(row(0)).getByRole('button', { name: '编辑', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle(row(0))).toBeFocused();
  await expect(toggle(row(0))).toHaveAttribute('aria-expanded', 'false');

  await drag(row(0), -125);
  await drag(row(1), -125);
  await expect(toggle(row(0))).toHaveAttribute('aria-expanded', 'false');
  await actions(row(1)).getByRole('button', { name: '编辑', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑账目', exact: true });
  await expect(edit.getByLabel('备注', { exact: true })).toHaveValue('虚构早餐 1');
  await edit.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click();

  await toggle(row(2)).click();
  await actions(row(2)).getByRole('button', { name: '复制', exact: true }).click();
  const copy = page.getByRole('dialog', { name: '复制记一笔', exact: true });
  await expect(copy.getByLabel('备注', { exact: true })).toHaveValue('虚构早餐 2');
  await copy.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click();

  await toggle(row(2)).click();
  await actions(row(2)).getByRole('button', { name: '删除', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: '删除账目', exact: true });
  await expect(deletion).toContainText('2026-11-06 08:00 · ¥ 1.00');
  await expect(detail).toHaveCount(0);
  await expect(row(2)).toHaveCount(1);
  await deletion.getByRole('button', { name: '取消', exact: true }).click();
  await row(2).locator('.entry-row').click();
  await expect(detail).toContainText('虚构早餐 2');
  await detail.getByRole('button', { name: '关闭', exact: true }).click();

  await toggle(row(2)).click();
  await actions(row(2)).getByRole('button', { name: '删除', exact: true }).click();
  await deletion.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(deletion).toBeHidden();
  await expect(row(2)).toHaveCount(0);
  await expect(page.locator('.entry-row')).toHaveCount(9);
});

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

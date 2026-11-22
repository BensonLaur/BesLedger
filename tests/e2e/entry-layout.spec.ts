import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import type { StoredVault } from '../../src/storage/backend';
import { chooseTimeWheel, setEntryTime } from '../support/entry-time-ui';
let modules: ViteDevServer, row: StoredVault;
test.beforeAll(async () => {
  modules = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const { compactFixture } = await modules.ssrLoadModule('/tests/support/compact-fixture.ts');
  row = await compactFixture();
});
test.afterAll(async () => {
  await modules?.close();
});
async function open(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-22T13:00:00+08:00'));
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
  }, row);
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill('fictional-compact-password');
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  return page.getByRole('dialog', { name: '记一笔', exact: true });
}
async function visibleBox(page: Page, selector: string) {
  const element = page.locator(selector);
  const box = await element.boundingBox();
  expect(box).not.toBeNull();
  const clipped = await element.evaluate((e) => {
    const rect = e.getBoundingClientRect();
    let parent = e.parentElement;
    while (parent) {
      if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(parent).overflowY)) {
        const boundary = parent.getBoundingClientRect();
        if (rect.top < boundary.top - 1 || rect.bottom > boundary.bottom + 1) return true;
      }
      parent = parent.parentElement;
    }
    return rect.top < 0 || rect.bottom > innerHeight + 1;
  });
  expect(clipped).toBe(false);
  return box!;
}
async function encryptedDigest(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('BesLedger.encrypted.v1');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('vault'),
            read = tx.objectStore('vault').get('vault');
          read.onsuccess = async () => {
            const hash = await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(JSON.stringify(read.result)),
            );
            resolve([...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join(''));
          };
          tx.oncomplete = () => db.close();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

test('分类单独滚动，金额备注与完整键盘在小屏和横屏固定可见，选择不写账', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const editor = await open(page);
  const encryptedBefore = await encryptedDigest(page);
  await editor.getByLabel('金额', { exact: true }).fill('12.34');
  for (const size of [
    { width: 393, height: 852 },
    { width: 320, height: 640 },
    { width: 852, height: 393 },
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(async () => Math.round((await page.locator('.entry-backdrop').boundingBox())!.height))
      .toBe(size.height);
    const upper = await visibleBox(page, '.entry-amount-card');
    const dock = await visibleBox(page, '.entry-keypad');
    await visibleBox(page, '.entry-note');
    await editor.getByRole('button', { name: '全部', exact: true }).click();
    await editor.locator('.entry-choices').evaluate((e) => (e.scrollTop = e.scrollHeight));
    const scrolled = await visibleBox(page, '.entry-keypad');
    expect(scrolled.y).toBeCloseTo(dock.y, 0);
    expect((await visibleBox(page, '.entry-amount-card')).y).toBeCloseTo(upper.y, 0);
    await editor.getByRole('button', { name: '返回常用分类', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('12.34');
  }
  await editor.getByRole('button', { name: '全部', exact: true }).click();
  await editor.getByLabel('搜索分类').fill('地铁');
  await editor.getByRole('button', { name: '交通 地铁', exact: true }).click();
  await expect(editor.getByRole('button', { name: '当前分类：地铁', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '全部分类' })).toHaveCount(0);
  expect(await encryptedDigest(page)).toBe(encryptedBefore);
});

test('文字键盘缩小可见视口时备注仍可编辑，完成后恢复数字键盘且保留草稿', async ({ page }) => {
  await page.addInitScript(() => {
    let forcedHeight: number | undefined;
    const viewport = Object.assign(new EventTarget(), {
      scale: 1,
      offsetTop: 0,
    });
    // WebKit 的 viewport meta 会在初始化脚本之后生效，未模拟键盘时须跟随真实布局。
    Object.defineProperties(viewport, {
      height: { get: () => forcedHeight ?? innerHeight },
      width: { get: () => innerWidth },
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    (window as any).entryTestViewport = (height: number) => {
      forcedHeight = height;
      viewport.dispatchEvent(new Event('resize'));
    };
  });
  await page.setViewportSize({ width: 393, height: 852 });
  const editor = await open(page);
  await editor.getByLabel('金额', { exact: true }).fill('42.00');
  await editor.getByRole('button', { name: '早餐', exact: true }).click();
  await editor.getByRole('button', { name: '展开备注', exact: true }).click();
  const text = '虚构长备注，粘贴后仍可检查。'.repeat(30);
  await editor.getByLabel('备注', { exact: true }).fill(text);
  await page.evaluate(() => (window as any).entryTestViewport(400));
  await expect(editor.locator('.entry-form')).toHaveClass(/keyboard-open/);
  await expect(editor.locator('.entry-keypad')).toBeHidden();
  const context = await editor.locator('.entry-context').boundingBox();
  const note = await editor.getByLabel('备注', { exact: true }).boundingBox();
  expect(context!.y + context!.height).toBeLessThanOrEqual(401);
  expect(note!.y + note!.height).toBeLessThanOrEqual(context!.y);
  await expect(editor.getByRole('button', { name: '修改发生时间', exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: '付款账户', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: '完成备注', exact: true }).click();
  await page.evaluate(() => (window as any).entryTestViewport(852));
  await expect(editor.locator('.entry-keypad')).toBeVisible();
  await visibleBox(page, '.entry-keypad');
  await expect(editor.getByLabel('备注', { exact: true })).toHaveValue(text);
  expect(await editor.getByLabel('备注', { exact: true }).evaluate((e) => e.scrollTop)).toBe(0);
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('42.00');
  await expect(editor.getByRole('button', { name: '当前分类：早餐', exact: true })).toBeVisible();
});

test('自动识别不展开底栏，歧义只在核对弹框选择，手改值和账户保持', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const editor = await open(page);
  await editor.getByRole('button', { name: '付款账户', exact: true }).click();
  await page
    .locator('.account-picker-backdrop')
    .getByRole('dialog')
    .getByRole('button', { name: '日常银行卡', exact: true })
    .click();
  await editor.getByRole('switch', { name: '自动识别备注' }).click();
  await editor.getByLabel('备注', { exact: true }).fill('停车费10元');
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('10.00');
  await expect(page.getByRole('dialog', { name: '备注识别结果' })).toHaveCount(0);
  await editor.getByRole('button', { name: '完成备注', exact: true }).click();
  await visibleBox(page, '.entry-keypad');
  await editor.getByLabel('备注', { exact: true }).fill('早餐10元，午餐20元');
  await editor.getByRole('button', { name: '保存账目', exact: true }).click();
  const review = page.getByRole('dialog', { name: '备注识别结果', exact: true });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: '20元 · ¥ 20.00', exact: true }).click();
  await review.getByRole('button', { name: '午餐', exact: true }).click();
  await review.getByRole('button', { name: '完成核对', exact: true }).click();
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('20.00');
  await expect(editor.getByRole('button', { name: '付款账户', exact: true })).toContainText('日常银行卡');
  await editor.getByLabel('金额', { exact: true }).fill('7.00');
  await editor.getByRole('button', { name: '早餐', exact: true }).click();
  await editor.getByLabel('备注', { exact: true }).fill('地铁8元');
  await expect(editor.locator('.recognition-summary')).toContainText('已保留当前填写');
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('7.00');
  await editor.getByRole('button', { name: '保存账目', exact: true }).click();
  await expect(editor).toBeHidden();
});

test('备注随内容增高、缩短后收回，时间账户扁平且长文不挤走键盘', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const editor = await open(page);
  const note = editor.getByLabel('备注', { exact: true });
  const short = await note.boundingBox();
  await note.fill('这是一段虚构的多行备注，文字会按内容逐行增高。'.repeat(3));
  await expect.poll(async () => (await note.boundingBox())!.height).toBeGreaterThan(short!.height + 20);
  const medium = (await note.boundingBox())!.height;
  await note.fill('虚构长备注。'.repeat(200));
  await expect.poll(async () => (await note.boundingBox())!.height).toBeGreaterThanOrEqual(medium);
  expect((await note.boundingBox())!.height).toBeLessThanOrEqual(113);
  await visibleBox(page, '.entry-keypad');
  expect(
    (await editor.getByRole('button', { name: '付款账户', exact: true }).boundingBox())!.height,
  ).toBeLessThanOrEqual(34);
  await note.fill('短备注');
  await expect.poll(async () => (await note.boundingBox())!.height).toBe(short!.height);
});

test('时间一键打开可滑动滚轮，跨日和年月闰日切换正确，取消保持草稿', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const editor = await open(page);
  const before = await editor.getByRole('button', { name: '修改发生时间', exact: true }).innerText();
  const vault = await encryptedDigest(page);
  await editor.getByRole('button', { name: '修改发生时间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '发生时间', exact: true });
  await expect(dialog.getByRole('tab', { name: '时间', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.getByRole('spinbutton', { name: '小时', exact: true })).toBeVisible();
  await expect(dialog.locator('input[type="datetime-local"]')).toHaveCount(0);
  await setEntryTime(dialog, '2024-02-29T23:59');
  await dialog.getByRole('tab', { name: '日期', exact: true }).click();
  await chooseTimeWheel(dialog, '年', '2025');
  await expect(dialog.getByLabel('已选时间')).toHaveText('2025-02-28 23:59');
  await dialog.getByRole('tab', { name: '时间', exact: true }).click();
  const minute = dialog.getByRole('spinbutton', { name: '分钟', exact: true });
  await minute.focus();
  await minute.press('ArrowDown');
  await expect(minute).toHaveAttribute('aria-valuetext', '00');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(editor.getByRole('button', { name: '修改发生时间', exact: true })).toHaveText(before);
  await editor.getByRole('button', { name: '修改发生时间', exact: true }).click();
  await setEntryTime(dialog, '2026-12-31T23:59');
  await chooseTimeWheel(dialog, '日期', '2027-01-01');
  await expect(dialog.getByLabel('已选时间')).toHaveText('2027-01-01 23:59');
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
  await expect(editor.getByRole('button', { name: '修改发生时间', exact: true })).toContainText(
    '2027-01-01 23:59',
  );
  await expect(editor.getByLabel('备注', { exact: true })).toHaveValue('');
  expect(await encryptedDigest(page)).toBe(vault);
});

test('滚动后吸附中央，滚轮与操作在窄屏、横屏可见且旋转不改时间', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const editor = await open(page);
  await editor.getByRole('button', { name: '修改发生时间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '发生时间', exact: true });
  const hour = dialog.getByRole('spinbutton', { name: '小时', exact: true });
  await chooseTimeWheel(dialog, '小时', '12');
  if (info.project.name === 'ipad-webkit') {
    // Playwright 不支持移动 WebKit 的鼠标滚轮；该平台保留键盘操作与布局检查。
    await hour.focus();
    await hour.press('ArrowDown');
    await hour.press('ArrowDown');
  } else {
    await hour.hover();
    await page.mouse.wheel(0, 72);
  }
  await expect(hour).toHaveAttribute('aria-valuetext', '14');
  await expect
    .poll(() =>
      hour.evaluate(
        (element) =>
          element.scrollTop % Number.parseFloat(getComputedStyle(element).getPropertyValue('--wheel-row')),
      ),
    )
    .toBe(0);
  const selectedTime = await dialog.getByLabel('已选时间').innerText();
  await page.setViewportSize({ width: 852, height: 393 });
  await visibleBox(page, '.entry-date-wheels');
  await expect(dialog.getByLabel('已选时间')).toHaveText(selectedTime);
  const button = await dialog.getByRole('button', { name: '确定', exact: true }).boundingBox();
  expect(button!.y + button!.height).toBeLessThanOrEqual(394);
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
});

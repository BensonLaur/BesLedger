import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
async function initialize(page: Page) {
  await page.goto('./');
  const logo = page.locator('.welcome-brand img');
  await expect(logo).toHaveAttribute('src', /\/assets\/brand-[\w-]+\.svg$/);
  const url = await logo.getAttribute('src');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', url!);
  await page.getByLabel('账本名称').fill('虚构支持入口测试');
  await page.getByLabel('解锁口令', { exact: true }).fill('fictional-support-preview');
  await page.getByRole('button', { name: '创建并继续' }).click();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本' }).click();
  await page.goto('./#/settings');
  await expect(page.locator('.settings-brand-icon')).toHaveAttribute('src', url!);
  return url;
}
async function stored(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('BesLedger.encrypted.v1');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('vault');
          const read = tx.objectStore('vault').get('vault');
          read.onsuccess = () => resolve(JSON.stringify(read.result));
          tx.oncomplete = () => db.close();
        };
      }),
  );
}
test('钱包标识一致，自愿支持切换与 PNG 保存不修改账本', async ({ page }, info) => {
  const logo = await initialize(page);
  const before = await stored(page);
  const entry = page.getByRole('button', { name: '支持 Bes记账 一起把记账做得更顺手' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await entry.click();
  const dialog = page.getByRole('dialog', { name: '让记账更顺手', exact: true });
  await expect(dialog.locator('.support-wallet')).toHaveAttribute('src', logo!);
  await expect(dialog.getByRole('link', { name: '查看 GitHub 源代码 ↗' })).toHaveAttribute(
    'href',
    'https://github.com/BensonLaur/BesLedger',
  );
  for (const [label, method, payee] of [
    ['微信', 'wechat', 'Benson(**城)'],
    ['支付宝', 'alipay', 'Bes软件'],
  ]) {
    await dialog.getByRole('button', { name: label, exact: true }).click();
    await expect(dialog.getByRole('button', { name: label, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(dialog.locator('.support-payee')).toContainText(payee);
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '保存收款码', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`BesLedger-${method}.png`);
    const target = info.outputPath(`${method}.png`);
    await download.saveAs(target);
    const actual = await sharp(target).ensureAlpha().raw().toBuffer();
    const original = await sharp(`src/assets/support/${method}.webp`).ensureAlpha().raw().toBuffer();
    expect(actual.equals(original), '保存的 PNG 与包内无损图片逐像素一致').toBe(true);
  }
  await dialog.getByRole('button', { name: '查看大图' }).click();
  await expect(page.getByRole('dialog', { name: '支付宝收款码大图' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(entry).toBeFocused();
  expect((await stored(page)) === before, '支持操作不改变账本存储').toBe(true);
});
test('手机底部卡片、桌面对话框、深色与离线二维码可用', async ({ page, context }, info) => {
  await initialize(page);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const width of [320, 393, 1024]) {
      await page.setViewportSize({ width, height: 852 });
      await page.getByRole('button', { name: '支持 Bes记账 一起把记账做得更顺手' }).click();
      const dialog = page.getByRole('dialog', { name: '让记账更顺手', exact: true });
      await expect
        .poll(() =>
          dialog
            .locator('.support-payment img')
            .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 1266),
        )
        .toBe(true);
      expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      expect(await dialog.locator('.modal-content').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
        true,
      );
      const close = await dialog.getByRole('button', { name: '关闭', exact: true }).boundingBox();
      expect(close!.y).toBeGreaterThanOrEqual(0);
      expect(close!.y + close!.height).toBeLessThanOrEqual(852);
      await dialog.screenshot({
        path: `artifacts/support-${info.project.name}-${width}-${scheme}.png`,
        animations: 'disabled',
      });
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    }
  }
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await page.getByLabel('解锁口令', { exact: true }).fill('fictional-support-preview');
  await page.getByRole('button', { name: '解锁账本', exact: true }).click();
  await page.getByRole('button', { name: '支持 Bes记账 一起把记账做得更顺手' }).click();
  await page.getByRole('button', { name: '支付宝', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('.support-payment img')
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 1080),
    )
    .toBe(true);
});

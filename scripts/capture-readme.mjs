// README 展示图只使用独立浏览器上下文与虚构样本，不接触用户设备、账本或 GitHub。
// 先 npm run build，再 node scripts/capture-readme.mjs；从生产构建截图，不修改页面 DOM 或样式。
import { createServer, preview } from 'vite';
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

const password = 'fictional-readme-preview-only';
const output = 'docs/images';
const originals = fs.mkdtempSync(path.join(os.tmpdir(), 'besledger-readme-'));
fs.mkdirSync(output, { recursive: true });
const modules = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});
let browser, serving;
try {
  const { Vault } = await modules.ssrLoadModule('/src/storage/vault.ts');
  const { put } = await modules.ssrLoadModule('/src/domain/model.ts');
  const { builtins } = await modules.ssrLoadModule('/src/domain/categories.ts');
  let stored;
  const vault = new Vault({
    read: async () => stored,
    compareSwap: async (expected, payload) => {
      if ((stored?.revision ?? 0) !== expected) throw Error('Preview revision mismatch');
      stored = { id: 'vault', revision: expected + 1, payload };
      return stored.revision;
    },
  });
  await vault.create(password);
  await vault.mutate((state) => {
    const ledgerId = 'readme-fictional-ledger';
    put(state, { kind: 'ledger', name: '日常生活' }, ledgerId);
    state.preferences.currentLedger = ledgerId;
    for (const [id, name, type, opening] of [
      ['bank', '日常银行卡', 'bank', 280000],
      ['cash', '随身现金', 'cash', 50000],
      ['wallet', '微信零钱', 'wallet', 68000],
      ['credit', '日常信用卡', 'credit', -42000],
    ])
      put(
        state,
        { kind: 'account', name, type, opening, openedAt: '2026-10-01T00:00:00', bank: '', tail: '' },
        `readme-${id}`,
      );
    const entry = (day, amount, category, note, account = 'bank', type = 'expense', time = '12:15') => {
      const at = `2026-10-${String(day).padStart(2, '0')}T${time}:00`;
      put(state, {
        kind: 'entry',
        ledgerId,
        type,
        amount,
        interest: 0,
        from: type === 'income' ? '' : `readme-${account}`,
        to: type === 'income' ? `readme-${account}` : '',
        categoryId: builtins.find((item) => item.name === category).id,
        at,
        note,
        behavior: '',
        createdAt: at,
      });
    };
    const lunch = [2400, 2800, 2200, 3200, 2600, 3800, 4200];
    for (let day = 1; day <= 22; day++) {
      entry(day, lunch[(day - 1) % 7], '午餐', '家常午餐');
      if (day % 3 !== 0) entry(day, 850 + (day % 4) * 100, '早餐', '豆浆与早点', 'cash', 'expense', '08:20');
      if (day % 4 === 0)
        entry(day, 6800 + day * 90, '买菜原料', '蔬菜、水果与日用品', 'wallet', 'expense', '18:30');
      if (day % 5 === 0) entry(day, 2800 + day * 80, '打车', '周末出行', 'credit', 'expense', '19:10');
    }
    entry(8, 600000, '工资薪水', '本月工资 · 虚构示例', 'bank', 'income', '09:00');
    entry(18, 40000, '奖金', '项目奖金 · 虚构示例', 'bank', 'income', '09:00');
    entry(22, 3650, '晚餐', '下班后的简餐', 'wallet', 'expense', '19:00');
    put(state, { kind: 'budget', ledgerId, month: '2026-10', enabled: true, amount: 250000 });
  });
  vault.lock();
  serving = await preview({ preview: { host: '127.0.0.1', port: 4187, strictPort: true, open: false } });
  browser = await chromium.launch({ channel: 'msedge' });
  const context = await browser.newContext({
    viewport: { width: 393, height: 1120 },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.clock.setFixedTime(new Date('2026-10-23T09:41:00+08:00'));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4187/BesLedger/');
  await expect(page.getByRole('button', { name: '创建账本' })).toBeVisible();
  // 使用与正式应用相同的加密存储格式；仅向新建的临时浏览器上下文写入虚构数据。
  await page.evaluate(async (value) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('BesLedger.encrypted.v1');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('vault', 'readwrite');
        tx.objectStore('vault').put(value);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, stored);
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  const sizes = [];
  async function capture(name) {
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const raw = path.join(originals, `${name}.png`);
    await page.screenshot({ path: raw, animations: 'disabled' });
    const destination = `${output}/${name}.png`;
    // 2x 原始截图缩到 1.5x，调色板压缩；仅做整体缩放，不改写画面内容。
    await sharp(raw)
      .resize({ width: 590 })
      .png({ palette: true, quality: 100, effort: 10, colours: 256 })
      .toFile(destination);
    sizes.push({
      file: destination,
      original: fs.statSync(raw).size,
      optimized: fs.statSync(destination).size,
    });
  }
  await capture('preview-home');
  await page
    .getByRole('navigation', { name: '底部导航' })
    .getByRole('button', { name: '记一笔', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: '记一笔', exact: true });
  await editor.getByRole('button', { name: '午餐', exact: true }).click();
  await editor.getByLabel('金额', { exact: true }).fill('28.00');
  await editor.getByLabel('备注', { exact: true }).fill('一碗面，一份小菜');
  await editor.getByRole('button', { name: '付款账户', exact: true }).click();
  await page
    .getByRole('dialog', { name: '选择资金账户' })
    .getByRole('button', { name: '日常银行卡' })
    .click();
  await editor.getByRole('button', { name: '当前分类：午餐' }).focus();
  await editor.locator('.modal-content').evaluate((element) => {
    element.scrollTop = 0;
  });
  await capture('preview-entry');
  await editor.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
  await page
    .getByRole('navigation', { name: '底部导航' })
    .getByRole('link', { name: '账户', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: '账户', exact: true })).toBeVisible();
  await capture('preview-accounts');
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify(
      { source: 'production Web/PWA', viewport: '393x1120', fictionalDataOnly: true, originals, sizes },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await modules.close();
  await new Promise((resolve) => (serving ? serving.httpServer.close(resolve) : resolve()));
}

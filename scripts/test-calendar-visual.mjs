// 直接读取已确认原型作为独立视觉基准；只在隔离浏览器比较组件，不改写应用账本。
import fs from 'node:fs';
import vm from 'node:vm';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import sharp from 'sharp';
const source = fs.readFileSync('docs/prototypes/besledger-ui.html', 'utf8');
const fn = source.match(/ function bar\(cents,ceiling\)\{[\s\S]*?\n \}/)[0];
const reference = vm.runInNewContext(`(${fn})`);
const colors = source.match(/#besledger-calendar-overview\{([^}]+)\}/)[1];
const server = await createServer({
  server: { host: '127.0.0.1', port: 4189, strictPort: true, open: false },
});
await server.listen();
const browser = await chromium.launch({ channel: 'msedge' });
const cases = [1, 3350, 17650, 20000, 20001, 100000, -3350, -17650, -20000, -100000];
const evidence = [];
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:4189/BesLedger/');
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate(
      async ({ cases, references, colors }) => {
        document.querySelector('#comparison')?.remove();
        const host = document.createElement('div');
        host.id = 'comparison';
        host.innerHTML = `<style>#comparison{${colors};background:var(--bc-paper);position:fixed;inset:0;z-index:10000;display:grid;grid-template-columns:repeat(2,40px);grid-auto-rows:40px;gap:12px;padding:20px}#comparison .slot{position:relative;width:40px;height:34px}#comparison svg{width:40px;height:34px;display:block}</style>`;
        document.body.append(host);
        const { createApp, h } = await import('/BesLedger/node_modules/.vite/deps/vue.js');
        const { default: CalendarBar } = await import('/BesLedger/src/app/components/CalendarBar.vue');
        for (let i = 0; i < cases.length; i++) {
          const old = document.createElement('div');
          old.className = 'slot reference';
          old.innerHTML = references[i];
          host.append(old);
          const current = document.createElement('div');
          current.className = 'slot current';
          host.append(current);
          createApp({ render: () => h(CalendarBar, { amount: cases[i], ceiling: 20000 }) }).mount(current);
        }
      },
      { cases, references: cases.map((v) => reference(v, 20000)), colors },
    );
    await expect(page.locator('.current svg')).toHaveCount(cases.length);
    for (let i = 0; i < cases.length; i++) {
      const old = await page.locator('.reference svg').nth(i).screenshot();
      const current = await page.locator('.current svg').nth(i).screenshot();
      const a = await sharp(old).ensureAlpha().raw().toBuffer();
      const b = await sharp(current).ensureAlpha().raw().toBuffer();
      expect(a.equals(b), `${theme} amount ${cases[i]} matches prototype pixels`).toBe(true);
      evidence.push({ theme, amount: cases[i], samePixels: true });
    }
  }
  fs.writeFileSync('artifacts/calendar-prototype-verification.json', JSON.stringify(evidence, null, 2));
  console.log(
    'PASS: 20 prototype vs Vue rendered pixel comparisons; low/exact-limit/over-limit/negative values in light and dark themes.',
  );
} finally {
  await browser.close();
  await server.close();
}

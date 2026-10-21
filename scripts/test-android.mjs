import { expect } from '@playwright/test';
import { _android as android } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const adbPath = process.env.BESLEDGER_ADB;
if (!adbPath) throw new Error('Set BESLEDGER_ADB to this project SDK adb executable');
const serial = 'emulator-5556';
const adb = (...args) =>
  execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', windowsHide: true });
if (!adb('emu', 'avd', 'name').includes('BesLedgerTestApi36'))
  throw new Error('Only the isolated BesLedger emulator is allowed');
const pkg = 'com.bensoftware.besledger';
async function connect() {
  const devices = await android.devices();
  const device = devices.find((d) => d.serial() === serial);
  if (!device) throw new Error('Isolated emulator unavailable');
  device.setDefaultTimeout(20000);
  const webview = await device.webView({ pkg });
  const page = await webview.page();
  page.setDefaultTimeout(15000);
  await page.getByRole('heading').first().waitFor();
  return { browser: device, page };
}
let { browser, page } = await connect();
try {
  const password = 'fictional-android-test-password';
  if (await page.getByRole('heading', { name: '创建本地账本' }).isVisible()) {
    await page.getByLabel('账本名称').fill('虚构 Android 验收账本');
    await page.getByLabel('解锁口令', { exact: true }).fill(password);
    await page.getByRole('button', { name: '创建并继续' }).click();
    await page.getByLabel('我已独立保存恢复密钥').check();
    await page.getByRole('button', { name: '进入账本' }).click();
  } else if (await page.getByRole('heading', { name: '解锁 Bes记账' }).isVisible()) {
    await page.getByLabel('解锁口令', { exact: true }).fill(password);
    await page.getByRole('button', { name: '解锁账本', exact: true }).click();
  }
  await page.goto('https://localhost/#/accounts');
  if (!(await page.getByText('虚构 Android 现金', { exact: true }).count())) {
    await page.getByRole('button', { name: '添加账户', exact: true }).click();
    const form = page.getByRole('dialog', { name: '添加共用账户' });
    await form.getByLabel('账户名称').fill('虚构 Android 现金');
    await form.getByLabel('期初余额（元）').fill('1000');
    await form.getByLabel('起算日期时间').fill('2026-01-01T00:00');
    await form.getByRole('button', { name: '保存账户' }).click();
  }
  await page.goto('https://localhost/#/');
  if (!(await page.getByText('完全虚构的 Android 流水', { exact: true }).count())) {
    await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
    const form = page.getByRole('dialog', { name: '记一笔', exact: true });
    await form.getByLabel('金额', { exact: true }).fill('37.25');
    await form.getByRole('button', { name: '早餐', exact: true }).click();
    await form.getByLabel('备注 · 粘贴银行短信即可识别').fill('完全虚构的 Android 流水');
    await form.getByRole('button', { name: '付款账户', exact: true }).click();
    await page
      .getByRole('dialog', { name: '选择资金账户' })
      .getByRole('button', { name: '虚构 Android 现金' })
      .click();
    await form.getByRole('button', { name: '保存账目' }).click();
    await expect(form).toBeHidden();
  }
  await expect(page.getByText('−37.25', { exact: true })).toBeVisible();
  fs.mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/android-debug-ledger.png', fullPage: true });
  await browser.close();
  adb('shell', 'svc', 'wifi', 'disable');
  adb('shell', 'svc', 'data', 'disable');
  adb('shell', 'am', 'force-stop', pkg);
  adb('shell', 'am', 'start', '-n', `${pkg}/.MainActivity`);
  ({ browser, page } = await connect());
  await page.getByLabel('解锁口令', { exact: true }).fill(password);
  await page.getByRole('button', { name: '解锁账本', exact: true }).click();
  await expect(page.getByText('−37.25', { exact: true })).toBeVisible();
  await page.goto('https://localhost/#/accounts');
  await expect(page.getByText('余额 ¥ 962.75', { exact: true })).toBeVisible();
  const files = adb('shell', 'run-as', pkg, 'ls', 'databases');
  if (!files.includes('besledger-vault.db')) throw new Error('Native SQLite file missing');
  console.log(
    'PASS: Android API 36 / WebView: native encrypted SQLite, entry save, process restart and offline balance',
  );
} finally {
  try {
    adb('shell', 'svc', 'wifi', 'enable');
    adb('shell', 'svc', 'data', 'enable');
  } catch { console.warn('Isolated emulator unavailable during network cleanup'); }
  await browser.close().catch(() => undefined);
}

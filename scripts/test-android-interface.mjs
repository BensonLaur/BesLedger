import { _android as android } from 'playwright';
import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const adbPath = process.env.BESLEDGER_ADB;
if (!adbPath) throw new Error('Set BESLEDGER_ADB');
const serial = 'emulator-5558',
  pkg = 'com.bensoftware.besledger';
const adb = (...args) =>
  execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', windowsHide: true });
if (!adb('emu', 'avd', 'name').includes('BesLedgerUiApi36'))
  throw new Error('Only the isolated UI emulator is allowed');
const password = 'fictional-native-interface-password';
let device, page;
async function connect() {
  device = (await android.devices()).find((d) => d.serial() === serial);
  if (!device) throw new Error('UI emulator unavailable');
  device.setDefaultTimeout(30000);
  page = await (await device.webView({ pkg })).page();
  page.setDefaultTimeout(20000);
}
async function noOverflow() {
  expect(
    await page.evaluate(() =>
      [document.documentElement, ...document.querySelectorAll('.modal-content,.page')]
        .filter((e) => e.clientWidth)
        .every((e) => e.scrollWidth <= e.clientWidth + 1),
    ),
  ).toBe(true);
}
try {
  await connect();
  await page.getByLabel('账本名称').fill('虚构 Android 界面验收');
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByLabel('再次输入密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账本' }).click();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本' }).click();
  const nav = page.getByRole('navigation', { name: '底部导航' });
  await expect(nav.locator(':scope > *')).toHaveCount(5);
  await nav.getByRole('link', { name: '账户', exact: true }).click();
  await expect(nav.getByRole('link', { name: '账户', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: '添加账户', exact: true }).click();
  await page.screenshot({ path: 'artifacts/native-ui-account-types.png', animations: 'disabled' });
  await page.getByRole('button', { name: '信用卡 消费欠款、还款与退款' }).click();
  await page.getByLabel('账户名称').fill('虚构信用卡');
  await page.getByLabel('还欠多少钱（元）').fill('100');
  await page.getByLabel('从什么时候开始记').fill('2026-01-01T00:00');
  await noOverflow();
  await page.getByRole('button', { name: '保存账户' }).click();
  await expect(page.getByRole('button', { name: '虚构信用卡，待还款 ¥ 100.00' })).toBeVisible();
  await nav.getByRole('link', { name: '首页', exact: true }).click();
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  const editor = page.getByRole('dialog', { name: '记一笔', exact: true });
  await editor.getByRole('button', { name: '午餐', exact: true }).click();
  await expect(editor.getByRole('button', { name: '当前分类：午餐' })).toBeVisible();
  await editor.getByRole('button', { name: '修改发生时间' }).click();
  // 使用真实系统返回键，确认只关闭最上层选择器，草稿仍在。
  adb('shell', 'input', 'keyevent', '4');
  await expect(page.getByRole('dialog', { name: '发生时间', exact: true })).toBeHidden();
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: '付款账户', exact: true }).click();
  await page
    .getByRole('dialog', { name: '选择资金账户' })
    .getByRole('button', { name: '虚构信用卡' })
    .click();
  for (const key of ['3', '2', '.', '5'])
    await editor.locator('.entry-keypad').getByRole('button', { name: key, exact: true }).click();
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('32.5');
  await editor.locator('.modal-content').evaluate((e) => (e.scrollTop = 0));
  await page.screenshot({ path: 'artifacts/native-ui-entry.png', animations: 'disabled' });
  await noOverflow();
  await editor
    .getByLabel('备注 · 粘贴银行短信即可识别')
    .fill('虚构软键盘验收：这是一条较长的备注，用来确认文字换行和保存操作。');
  await editor.getByLabel('备注 · 粘贴银行短信即可识别').click();
  await editor.getByRole('button', { name: '保存账目' }).scrollIntoViewIfNeeded();
  await noOverflow();
  const saveBounds = await editor.getByRole('button', { name: '保存账目' }).boundingBox();
  const visibleHeight = await page.evaluate(() => window.visualViewport?.height || innerHeight);
  expect(saveBounds.y + saveBounds.height).toBeLessThanOrEqual(visibleHeight + 2);
  await editor.getByRole('button', { name: '保存账目' }).click();
  await expect(page.getByText('−32.50', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await page.screenshot({ path: 'artifacts/native-ui-home.png', animations: 'disabled' });
  await nav.getByRole('link', { name: '账户', exact: true }).click();
  await expect(page.getByRole('button', { name: '虚构信用卡，待还款 ¥ 132.50' })).toBeVisible();
  await Promise.race([
    device.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  adb('shell', 'am', 'force-stop', pkg);
  adb('shell', 'am', 'start', '-n', `${pkg}/.MainActivity`);
  await connect();
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  if (!page.url().endsWith('#/accounts')) await page.goto('https://localhost/#/accounts');
  await expect(page.getByRole('button', { name: '虚构信用卡，待还款 ¥ 132.50' })).toBeVisible();
  expect(adb('shell', 'run-as', pkg, 'ls', 'databases')).toContain('besledger-vault.db');
  const result =
    'PASS: API 36 WebView: five-item navigation, selected category/icon, credit opening sign, no horizontal overflow, keypad save, native back stack, SQLite and process restart.';
  fs.writeFileSync('artifacts/native-ui-result.txt', result + '\r\n');
  console.log(result);
} finally {
  await Promise.race([
    device?.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

// Windows 驱动断开可能保留调试套接字；断言与证据写入均已完成，再结束测试进程。
process.exit(0);

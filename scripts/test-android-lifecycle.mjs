import { _android as android } from 'playwright';
import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
const adbPath = process.env.BESLEDGER_ADB;
if (!adbPath) throw new Error('Set BESLEDGER_ADB');
const serial = 'emulator-5556',
  pkg = 'com.bensoftware.besledger';
const adb = (...args) =>
  execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', windowsHide: true });
if (!adb('emu', 'avd', 'name').includes('BesLedgerTestApi36'))
  throw new Error('Only isolated emulator allowed');
const previous = adb('shell', 'settings', 'get', 'secure', 'show_ime_with_hard_keyboard').trim();
adb('shell', 'am', 'force-stop', pkg);
adb('shell', 'am', 'start', '-n', `${pkg}/.MainActivity`);
const device = (await android.devices()).find((d) => d.serial() === serial);
if (!device) throw new Error('Emulator unavailable');
try {
  adb('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1');
  const page = await (await device.webView({ pkg })).page();
  await page.getByRole('heading').first().waitFor();
  if (await page.getByRole('heading', { name: '欢迎回来' }).isVisible()) {
    await page.getByLabel('解锁密码', { exact: true }).fill('fictional-android-test-password');
    await page.getByRole('button', { name: '打开账本', exact: true }).click();
  }
  await page.goto('https://localhost/#/');
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  const form = page.getByRole('dialog', { name: '记一笔', exact: true });
  await form.getByLabel('备注', { exact: true }).click();
  await expect
    .poll(() => /mInputShown=true/.test(adb('shell', 'dumpsys', 'input_method')), { timeout: 10000 })
    .toBe(true);
  await form.getByRole('button', { name: '保存账目' }).scrollIntoViewIfNeeded();
  const bounds = await form.getByRole('button', { name: '保存账目' }).boundingBox();
  const height = await page.evaluate(() => innerHeight);
  if (!bounds || bounds.y + bounds.height > height + 1) throw new Error('Keyboard obscures save action');
  adb('shell', 'screencap', '-p', '/data/local/tmp/besledger-keyboard.png');
  adb('pull', '/data/local/tmp/besledger-keyboard.png', 'artifacts/android-keyboard.png');
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await expect.poll(() => /mInputShown=true/.test(adb('shell', 'dumpsys', 'input_method'))).toBe(false);
  await form.getByLabel('备注', { exact: true }).fill('虚构返回键草稿');
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  const confirm = page.getByRole('dialog', { name: '保留未保存草稿？' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '继续填写' }).click();
  await expect(form.getByLabel('备注', { exact: true })).toHaveValue('虚构返回键草稿');
  if (/mInputShown=true/.test(adb('shell', 'dumpsys', 'input_method'))) {
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await expect.poll(() => /mInputShown=true/.test(adb('shell', 'dumpsys', 'input_method'))).toBe(false);
  }
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await confirm.getByRole('button', { name: '放弃草稿' }).click();
  adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
  adb('shell', 'am', 'start', '-n', `${pkg}/.MainActivity`);
  await expect(page.getByText('−37.25', { exact: true })).toBeVisible();
  console.log(
    'PASS: Android soft keyboard, save visibility, back-key draft confirmation and foreground resume',
  );
} finally {
  if (previous === 'null') adb('shell', 'settings', 'delete', 'secure', 'show_ime_with_hard_keyboard');
  else adb('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', previous);
  await device.close();
}

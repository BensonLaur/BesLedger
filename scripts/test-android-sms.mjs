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
const device = (await android.devices()).find((d) => d.serial() === serial);
if (!device) throw new Error('Emulator unavailable');
device.setDefaultTimeout(10000);
try {
  const page = await (await device.webView({ pkg })).page();
  // 初次请求已通过界面发起；先验证系统拒绝确实回到粘贴路径。
  await device.tap({ res: 'com.android.permissioncontroller:id/permission_deny_button' });
  await expect(
    page
      .getByRole('dialog', { name: '从银行短信导入' })
      .getByText('短信权限被拒绝或安装渠道不允许，请继续使用备注粘贴'),
  ).toBeVisible();
  await page.getByRole('button', { name: '请求权限并读取候选' }).click();
  await device.tap({ res: 'com.android.permissioncontroller:id/permission_allow_button' });
  await expect(page.getByRole('button', { name: '请求权限并读取候选' })).toBeEnabled();
  const permission = adb('shell', 'dumpsys', 'package', pkg);
  if (!/READ_SMS: granted=true/.test(permission)) throw new Error('SMS permission was not granted');
  adb(
    'emu',
    'sms',
    'send',
    '95588',
    '尾号1234卡2026年10月22日08:09支出(消费示例早餐)6.50元，余额2,800.50元。【工商银行】',
  );
  await page.getByRole('button', { name: '请求权限并读取候选' }).click();
  const candidate = page
    .getByRole('dialog', { name: '从银行短信导入' })
    .getByLabel(/尾号1234卡2026年10月22日08:09/);
  await expect(candidate).toBeVisible();
  await candidate.check();
  await page.getByRole('button', { name: '逐条核对 1 条短信' }).click();
  await expect(
    page.getByRole('dialog', { name: '记一笔', exact: true }).getByText(/金额 ¥ 6.50/),
  ).toBeVisible();
  adb('shell', 'pm', 'revoke', pkg, 'android.permission.READ_SMS');
  console.log(
    'PASS: SMS permission denial, ordinary runtime grant, bank/date candidates, explicit selection, local recognition and revocation',
  );
} finally {
  await device.close();
}

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
adb('shell', 'pm', 'revoke', pkg, 'android.permission.READ_SMS');
adb('shell', 'pm', 'clear-permission-flags', pkg, 'android.permission.READ_SMS', 'user-set', 'user-fixed');
adb('shell', 'am', 'start', '-n', `${pkg}/.MainActivity`);
const device = (await android.devices()).find((d) => d.serial() === serial);
if (!device) throw new Error('Emulator unavailable');
device.setDefaultTimeout(10000);
let failure;
try {
  const page = await (await device.webView({ pkg })).page();
  await page.getByRole('heading').first().waitFor();
  if (await page.getByRole('heading', { name: '解锁 Bes记账' }).isVisible()) {
    await page.getByLabel('解锁口令', { exact: true }).fill('fictional-android-test-password');
    await page.getByRole('button', { name: '解锁账本', exact: true }).click();
  }
  await page.goto('https://localhost/#/settings');
  await page.getByRole('button', { name: '从银行短信导入', exact: true }).click();
  await page.getByLabel('同意本次在设备内读取上述范围，最多 31 天、200 条候选').check();
  await page.getByRole('button', { name: '请求权限并读取候选' }).click();
  // 只重置隔离测试应用的用户选择，仍通过系统弹窗正常拒绝/授权，不改变受限权限白名单。
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
  await expect
    .poll(
      async () => {
        await page.getByRole('button', { name: '请求权限并读取候选' }).click();
        return page
          .getByRole('dialog', { name: '从银行短信导入' })
          .getByLabel(/尾号1234卡2026年10月22日08:09/)
          .count();
      },
      { timeout: 10000 },
    )
    .toBeGreaterThan(0);
  const candidate = page
    .getByRole('dialog', { name: '从银行短信导入' })
    .getByLabel(/尾号1234卡2026年10月22日08:09/)
    .first();
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
} catch (error) {
  failure = error;
} finally {
  // 撤回权限会杀掉 WebView，实验性驱动断开有时不返回；只结束本次测试进程。
  await Promise.race([
    device.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}
if (failure) {
  console.error(failure);
  process.exit(1);
}
process.exit(0);

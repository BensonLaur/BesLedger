import { _android as android } from 'playwright';
import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { unlockKey, deriveCredentialKey, encrypt } from '../src/crypto/vault.ts';

const adbPath = process.env.BESLEDGER_ADB;
if (!adbPath) throw new Error('Set BESLEDGER_ADB');
const serial = 'emulator-5556',
  pkg = 'com.bensoftware.besledger';
const adb = (...args) =>
  execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', windowsHide: true });
if (!adb('emu', 'avd', 'name').includes('BesLedgerTestApi36'))
  throw new Error('Only isolated emulator allowed');
const password = 'fictional-android-test-password';
let device, page;
async function connect() {
  device = (await android.devices()).find((d) => d.serial() === serial);
  if (!device) throw new Error('Isolated emulator unavailable');
  device.setDefaultTimeout(20000);
  page = await (await device.webView({ pkg })).page();
  page.setDefaultTimeout(15000);
  await page.getByRole('heading').first().waitFor();
}
async function unlock() {
  if (await page.getByRole('heading', { name: '欢迎回来' }).isVisible()) {
    await page.getByLabel('解锁密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '打开账本', exact: true }).click();
    await expect(page.locator('.app-shell')).toBeVisible();
    if (await page.locator('.connection-summary').count()) await page.locator('.connection-summary').click();
  }
  await page.goto('https://localhost/#/settings');
}
const native = (method, options = {}) =>
  page.evaluate(({ method, options }) => window.Capacitor.nativePromise('EncryptedVault', method, options), {
    method,
    options,
  });

let failure;
try {
  await connect();
  await unlock();
  const record = (await native('read')).value;
  if (!record) throw new Error('Run the base native fictional-data test first');
  const saved = (await native('readCredential')).value;
  if (saved?.payload) throw new Error('Existing credential must not be overwritten by this fixture');
  const { raw } = await unlockKey(JSON.parse(record.payload).header, password);
  const authKey = await deriveCredentialKey(raw);
  raw.fill(0);
  // 仅注入明确虚构的已授权会话，验证原生持久化；不冒充真实 GitHub 登录。
  const payload = JSON.stringify(
    await encrypt(
      {
        version: 2,
        id: crypto.randomUUID(),
        user: { id: 42, login: 'fictional-native-user' },
        tokens: {
          accessToken: 'ghu_fictionalNative',
          refreshToken: 'fictional-native-refresh',
          app: {
            id: Number(process.env.BESLEDGER_TEST_APP_ID),
            clientId: process.env.BESLEDGER_TEST_APP_CLIENT_ID,
            slug: process.env.BESLEDGER_TEST_APP_SLUG,
          },
        },
      },
      authKey,
      'local-github-session',
    ),
  );
  if (!(await native('compareSwapCredential', { expected: saved?.revision ?? 0, payload })).saved)
    throw new Error('Fixture compare/swap failed');
  const stored = (await native('readCredential')).value;
  if (stored.payload.includes('fictional-native')) throw new Error('Native credential was not encrypted');
  await page.reload();
  await unlock();
  await expect(page.getByRole('button', { name: '退出 GitHub', exact: true })).toBeVisible();
  if (await page.getByRole('dialog', { name: '跨设备同步' }).count())
    await page
      .getByRole('dialog', { name: '跨设备同步' })
      .getByRole('button', { name: '关闭', exact: true })
      .click();
  await page.getByRole('button', { name: '锁定账本', exact: true }).last().click();
  await unlock();
  await expect(page.getByRole('button', { name: '退出 GitHub', exact: true })).toBeVisible();
  await device.close();
  adb('shell', 'svc', 'wifi', 'disable');
  adb('shell', 'svc', 'data', 'disable');
  adb('shell', 'am', 'force-stop', pkg);
  adb('shell', 'am', 'start', '-n', `${pkg}/.MainActivity`);
  await connect();
  await unlock();
  await expect(page.getByRole('button', { name: '退出 GitHub', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '退出 GitHub', exact: true }).click();
  await expect(page.getByRole('button', { name: '使用 GitHub 登录' })).toBeVisible();
  if ((await native('readCredential')).value.payload !== null)
    throw new Error('Logout did not clear credential');
  await page.reload();
  await unlock();
  await expect(page.getByRole('button', { name: '使用 GitHub 登录' })).toBeVisible();
  console.log(
    'PASS: Android SQLite encrypted credential, refresh/lock/process restart/offline restore and persistent logout; fictional authorization fixture only',
  );
} catch (error) {
  failure = error;
} finally {
  adb('shell', 'svc', 'wifi', 'enable');
  adb('shell', 'svc', 'data', 'enable');
  await Promise.race([
    device?.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}
if (failure) {
  console.error(failure);
  process.exit(1);
}
process.exit(0);

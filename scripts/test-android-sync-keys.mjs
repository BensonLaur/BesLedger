import { _android as android } from 'playwright';
import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { deriveCredentialKey, encrypt, importKey, recoveryText, unlockKey } from '../src/crypto/vault.ts';
import { githubSyncFixture } from '../tests/support/github-sync-fixture.ts';

const adbPath = process.env.BESLEDGER_ADB;
if (!adbPath) throw new Error('Set BESLEDGER_ADB');
const serial = process.env.BESLEDGER_TEST_SERIAL || 'emulator-5556',
  pkg = 'com.bensoftware.besledger';
const adb = (...args) =>
  execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', windowsHide: true });
if (!/BesLedger(Test|Ui)Api36/.test(adb('emu', 'avd', 'name')) || !serial.startsWith('emulator-'))
  throw new Error('Only isolated emulator allowed');
const app = {
  id: Number(process.env.BESLEDGER_TEST_APP_ID),
  clientId: process.env.BESLEDGER_TEST_APP_CLIENT_ID,
  slug: process.env.BESLEDGER_TEST_APP_SLUG,
};
if (!app.id || !app.clientId || !app.slug) throw new Error('Set public test App identity');
const password = 'fictional-native-sync-password';
const remote = githubSyncFixture(app.id);
const ledgerId = crypto.randomUUID(),
  keyBytes = crypto.getRandomValues(new Uint8Array(32));
const recovery = recoveryText(keyBytes),
  cloudKey = await importKey(keyBytes);
keyBytes.fill(0);
const ledger = {
  id: ledgerId,
  clock: { 'fixture-source': 1 },
  deleted: false,
  data: { kind: 'ledger', name: '虚构 Android 云端密钥验收' },
};
remote.files.set(`${ledgerId}.json`, {
  sha: '1'.repeat(40),
  content: Buffer.from(
    JSON.stringify(
      await encrypt(
        { format: 'BesLedger.ledger', version: 1, ledgerId, entities: { [ledgerId]: ledger } },
        cloudKey,
        `ledger:${ledgerId}`,
      ),
    ),
  ).toString('base64'),
});
let device, page;
async function connect() {
  device = (await android.devices()).find((d) => d.serial() === serial);
  if (!device) throw new Error('Isolated emulator unavailable');
  device.setDefaultTimeout(30000);
  page = await (await device.webView({ pkg })).page();
  page.setDefaultTimeout(20000);
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request(),
      reply = remote.handle(req.url(), req.method(), req.postData() ? req.postDataJSON() : undefined);
    await route.fulfill({ status: reply.status, json: reply.body });
  });
  await page.getByRole('heading').first().waitFor();
}
const native = (method, options = {}) =>
  page.evaluate(({ method, options }) => window.Capacitor.nativePromise('EncryptedVault', method, options), {
    method,
    options,
  });
async function unlock() {
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.getByRole('link', { name: '我的', exact: true }).first()).toBeVisible();
}
async function books() {
  if (new URL(page.url()).hash !== '#/books') await page.goto('https://localhost/#/books');
  await expect(page.getByRole('button', { name: '退出 GitHub', exact: true })).toBeVisible();
  await expect(page.getByText('已准备：fictional-user/BesLedger-Data', { exact: true })).toBeVisible({
    timeout: 30000,
  });
}
async function sync() {
  await books();
  const input = page.getByLabel('原设备的同步恢复密钥（跨端下载时填写）');
  await expect(input).toHaveValue('');
  const button = page.getByRole('button', { name: '同步', exact: true });
  await expect(button).toBeEnabled();
  if (await page.getByRole('button', { name: '关闭提示', exact: true }).isVisible())
    await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await button.click();
  await expect(page.getByRole('status')).toContainText('同步成功', { timeout: 30000 });
}
try {
  adb('shell', 'am', 'start', '-n', `${pkg}/.MainActivity`);
  await connect();
  await page.getByLabel('账本名称').fill('虚构 Android 本地账');
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByLabel('再次输入密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账本' }).click();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本' }).click();
  await expect(page.getByRole('link', { name: '我的', exact: true }).first()).toBeVisible();
  const record = (await native('read')).value,
    saved = (await native('readCredential')).value;
  if (saved?.payload) throw new Error('Existing credential must not be overwritten');
  const { raw } = await unlockKey(JSON.parse(record.payload).header, password);
  const authKey = await deriveCredentialKey(raw);
  raw.fill(0);
  // 只模拟已授权会话与远端 API，实际 WebView、加密与 SQLite 不替换。
  const payload = JSON.stringify(
    await encrypt(
      {
        version: 2,
        id: crypto.randomUUID(),
        user: { id: 42, login: 'fictional-user' },
        tokens: { accessToken: 'ghu_fictionalNativeSync', app },
      },
      authKey,
      'local-github-session',
    ),
  );
  if (!(await native('compareSwapCredential', { expected: saved?.revision ?? 0, payload })).saved)
    throw new Error('Credential fixture CAS failed');
  await page.reload();
  await unlock();
  await books();
  await page.getByLabel('原设备的同步恢复密钥（跨端下载时填写）').fill(recovery);
  await page.getByRole('button', { name: '解密并下载', exact: true }).click();
  await expect(page.getByText('同步密钥已在此设备加密保存', { exact: true })).toBeVisible();
  await page.goto('https://localhost/#/settings');
  await sync();
  const stored = (await native('read')).value;
  if (
    stored.payload.includes(recovery) ||
    Object.keys(JSON.parse(stored.payload).deviceSyncKeys).length !== 1
  )
    throw new Error('Native key persistence was not encrypted');
  if (!adb('shell', 'run-as', pkg, 'ls', 'databases').includes('besledger-vault.db'))
    throw new Error('Native SQLite file missing');
  await page.goto('https://localhost/#/settings');
  await page.getByRole('button', { name: '锁定', exact: true }).click();
  await unlock();
  await sync();
  await Promise.race([
    device.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  adb('shell', 'am', 'force-stop', pkg);
  adb('shell', 'am', 'start', '-n', `${pkg}/.MainActivity`);
  await connect();
  await unlock();
  await sync();
  await page.getByRole('button', { name: '同步密钥', exact: true }).click();
  await page.getByRole('button', { name: '忘记此设备密钥', exact: true }).click();
  await expect(page.getByText('同步密钥已在此设备加密保存', { exact: true })).toHaveCount(0);
  await expect(page.locator('.book-name').filter({ hasText: '虚构 Android 云端密钥验收' })).toBeVisible();
  await page.getByRole('button', { name: '退出 GitHub', exact: true }).click();
  console.log(
    'PASS: native API 36 WebView/SQLite: verified cloud key encrypted, route return, lock/unlock and process restart sync without re-entry; forget preserves ledger. GitHub API/session simulated.',
  );
} finally {
  await Promise.race([
    device?.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

// Windows 驱动断开可能保留调试套接字；断言与证据写入均已完成，再结束测试进程。
process.exit(0);

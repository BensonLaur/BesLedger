import { chromium } from 'playwright';
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
let browser, page, forwardedPort;
async function disconnect() {
  await browser?.close().catch(() => undefined);
  browser = undefined;
  if (forwardedPort) adb('forward', '--remove', `tcp:${forwardedPort}`);
  forwardedPort = undefined;
}
async function connect() {
  let socket;
  // 重启后必须连接当前应用进程的套接字，不能复用已退出 WebView 的调试目标。
  for (let attempt = 0; attempt < 60; attempt++) {
    let pid = '';
    try {
      pid = adb('shell', 'pidof', pkg).trim();
    } catch {
      // Activity 启动返回时，进程可能还未创建。
    }
    const candidate = `webview_devtools_remote_${pid}`;
    if (pid && adb('shell', 'cat', '/proc/net/unix').includes(candidate)) {
      socket = candidate;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!socket) throw new Error('Current application WebView socket unavailable');
  forwardedPort = adb('forward', 'tcp:0', `localabstract:${socket}`).trim();
  if (!/^\d+$/.test(forwardedPort)) throw new Error('WebView forwarding port unavailable');
  // 保留原生 WebView 的焦点和媒体设置；测试只控制当前隔离应用的调试会话。
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${forwardedPort}`, { noDefaults: true });
  const context = browser.contexts()[0];
  page = context.pages()[0];
  if (!page) throw new Error('Current application page unavailable');
  page.setDefaultTimeout(30000);
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request(),
      reply = remote.handle(req.url(), req.method(), req.postData() ? req.postDataJSON() : undefined);
    await route.fulfill({ status: reply.status, json: reply.body });
  });
  await page.waitForURL('https://localhost/**');
  await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 60000 });
}
async function restart() {
  await disconnect();
  adb('shell', 'am', 'force-stop', pkg);
  adb('shell', 'am', 'start', '-n', `${pkg}/.MainActivity`);
  await connect();
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
  await expect(page.locator('.connection-summary')).toContainText('已登录');
  await expect(page.getByText('连接已就绪，选择要同步的账本。', { exact: true })).toBeVisible({
    timeout: 30000,
  });
}
async function sync() {
  await books();
  const card = page.locator(`[data-book-id="${ledgerId}"]`);
  const button = card.getByRole('button', { name: '同步', exact: true });
  await expect(button).toBeEnabled({ timeout: 30000 });
  if (await page.getByRole('button', { name: '关闭提示', exact: true }).isVisible())
    await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await button.click();
  await expect(page.getByRole('status')).toContainText('同步成功', { timeout: 30000 });
  await expect(card.getByText('上次同步成功', { exact: true })).toBeVisible();
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
  // 原生凭证通过实际进程重启读回，避免 WebView 自动化热重载遗留桥接回调。
  await restart();
  await unlock();
  await books();
  await page.getByRole('button', { name: '预览并下载', exact: true }).click();
  const transfer = page.getByRole('dialog', { name: '取回这本账', exact: true });
  await transfer.getByLabel('原设备的恢复密钥', { exact: true }).fill(recovery);
  await transfer.getByRole('button', { name: '验证并预览', exact: true }).click();
  await transfer.getByRole('button', { name: '确认添加账本', exact: true }).click();
  // 确认后仍需重新校验远端并写入 SQLite；完成前跳页会按产品规则取消取回。
  await expect(transfer).toBeHidden({ timeout: 30000 });
  await expect(page.locator(`[data-book-id="${ledgerId}"]`)).toBeVisible();
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
  await page.getByRole('button', { name: '锁定账本', exact: true }).last().click();
  await unlock();
  await sync();
  await restart();
  await unlock();
  await sync();
  await page.getByRole('button', { name: '虚构 Android 云端密钥验收的更多操作', exact: true }).click();
  await page.getByRole('button', { name: '同步密钥', exact: true }).click();
  await page.getByRole('button', { name: '忘记这里保存的密钥', exact: true }).click();
  await expect(page.getByRole('heading', { name: '虚构 Android 云端密钥验收', exact: true })).toBeVisible();
  await page.locator('.connection-summary').click();
  await page.getByRole('button', { name: '退出 GitHub', exact: true }).click();
  console.log(
    'PASS: native API 36 WebView/SQLite: verified cloud key encrypted, route return, lock/unlock and process restart sync without re-entry; forget preserves ledger. GitHub API/session simulated.',
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await disconnect();
}

// 明确保留断言失败状态，结束连接库可能遗留的后台句柄。
process.exit(process.exitCode || 0);

import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
const serial = 'emulator-5556';
const pkg = 'com.bensoftware.besledger';
const adbPath = process.env.BESLEDGER_ADB;
if (!adbPath) throw Error('Set BESLEDGER_ADB');
const adb = (...args) =>
  execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8', windowsHide: true });
if (!serial.startsWith('emulator-') || !adb('emu', 'avd', 'name').startsWith('BesLedgerTestApi36'))
  throw Error('Only isolated test emulator allowed');
if (adb('shell', 'id', '-u').trim() !== '0')
  throw Error('Synthetic inbox setup needs adbd root on the test emulator');
const format = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
function send(sender, body, now) {
  if (!/^\d+$/.test(sender)) throw Error('Unsafe sender in fixture');
  const payload = Buffer.from(body.replaceAll(':', '：'), 'utf8').toString('base64');
  const outcome = adb(
    'shell',
    'content insert --uri content://sms/inbox' +
      ' --bind address:s:' +
      sender +
      ' --bind type:i:1 --bind date:l:' +
      now +
      ' --bind "body:s:$(printf %s ' +
      payload +
      ' | base64 -d)"',
  );
  if (/error|exception/i.test(outcome)) throw Error(outcome.trim().split(/\r?\n/).slice(-3).join(' '));
}
let port, browser, page;
async function connect() {
  let socket = '';
  for (let i = 0; i < 40; i++) {
    try {
      const pid = adb('shell', 'pidof', pkg).trim();
      const expected = 'webview_devtools_remote_' + pid;
      if (pid && adb('shell', 'cat', '/proc/net/unix').includes(expected)) {
        socket = expected;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!socket) throw Error('Current emulator WebView unavailable');
  port = adb('forward', 'tcp:0', 'localabstract:' + socket).trim();
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { noDefaults: true });
  page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(18000);
}
async function disconnect() {
  await browser?.close();
  if (port) adb('forward', '--remove', 'tcp:' + port);
  browser = undefined;
  port = undefined;
}
try {
  // 只清理隔离模拟器内本脚本使用的虚构应用状态。
  adb('shell', 'pm', 'clear', pkg);
  adb('shell', 'pm', 'grant', pkg, 'android.permission.READ_SMS');
  adb('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
  await connect();
  const password = 'fictional-sms-emulator-passphrase';
  await page.getByLabel('账本名称').fill('虚构 Android 短信验收');
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByLabel('再次输入密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账本', exact: true }).click();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本', exact: true }).click();
  await page.goto('https://localhost/#/accounts');
  await page.getByRole('button', { name: '添加账户', exact: true }).click();
  await page
    .getByRole('dialog', { name: '选择账户类型' })
    .getByRole('button', { name: '储蓄卡 / 借记卡 工资卡、日常消费银行卡', exact: true })
    .click();
  const account = page.getByRole('dialog', { name: '添加账户', exact: true });
  await account.getByLabel('账户名称').fill('虚构验收储蓄卡');
  await account.getByLabel('账户里有多少钱（元）').fill('1000');
  await account.getByLabel('从什么时候开始记').fill('2026-01-01T00:00');
  await account.getByLabel('银行名称（选填）').fill('中国银行');
  await account.getByLabel('卡号后四位（选填）').fill('1357');
  await account.getByRole('button', { name: '保存账户', exact: true }).click();
  await expect(account).toBeHidden();
  const now = await page.evaluate(() => Date.now());
  function stamp(minutes) {
    const [day, time] = format.format(new Date(now - minutes * 60000)).split(' ');
    const [y, m, d] = day.split('-');
    return y + '年' + Number(m) + '月' + Number(d) + '日' + time.slice(0, 5);
  }
  const one = '尾号1357卡' + stamp(4) + '支出(虚构奶茶店)8元。【中国银行】';
  const two = '尾号1357卡' + stamp(3) + '支出(虚构园区)8元。【中国银行】';
  for (const message of [
    one,
    two,
    one,
    '尾号1357卡请及时还款，应还金额18元。【中国银行】',
    '虚构验证码，仅做验收。',
  ])
    send('95566', message, now);
  send('95599', '尾号1357卡' + stamp(5) + '支出(另一银行奶茶店)8元。【中国银行】', now);
  await page.goto('https://localhost/#/');
  async function find() {
    await page.getByRole('button', { name: '快捷', exact: true }).click();
    await page.getByRole('button', { name: '短信记账', exact: true }).click();
    const importPage = page.getByRole('dialog', { name: '短信记账', exact: true });
    const range = format.format(new Date(now)).slice(0, 10);
    await importPage.getByLabel('银行发送方').selectOption('95566');
    await importPage.getByLabel('开始日期').fill(range);
    await importPage.getByLabel('结束日期').fill(range);
    await importPage.getByLabel('同意本次在手机上读取所选银行和日期内的候选短信').check();
    await importPage.getByRole('button', { name: '查找交易', exact: true }).click();
    return importPage;
  }
  const inbox = await find();
  await expect(inbox.getByRole('button', { name: '可保存 1', exact: true })).toBeVisible({ timeout: 15000 });
  await inbox.getByRole('button', { name: '待核对 1', exact: true }).click();
  await inbox.getByRole('button', { name: '选择分类', exact: true }).click();
  await inbox.getByLabel('交易分类').selectOption({ label: '停车费' });
  await inbox.getByRole('button', { name: '确认本笔', exact: true }).click();
  await inbox.getByRole('button', { name: '保存 2 笔', exact: true }).click();
  await expect(inbox.getByRole('status')).toHaveText('已保存 2 笔');
  console.log('Android inbox query, filtering, review and batch save passed');
  await disconnect();
  adb('shell', 'am', 'force-stop', pkg);
  adb('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
  await connect();
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  const rescanned = await find();
  await expect(rescanned.getByRole('button', { name: '已记账 2', exact: true })).toBeVisible();
  await expect(rescanned.getByRole('button', { name: '保存 0 笔', exact: true })).toBeDisabled();
  console.log('Android native restart/reload deduplication passed');
} finally {
  await disconnect();
}

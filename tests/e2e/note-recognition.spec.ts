import { expect, test, type Page } from '@playwright/test';
test.use({ reducedMotion: 'reduce' });
const password = 'fictional-note-recognition-password';
async function setup(page: Page) {
  await page.goto('./');
  await page.getByLabel('账本名称').fill('虚构手写备注测试账');
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByLabel('再次输入密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账本', exact: true }).click();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本', exact: true }).click();
  await page.goto('./#/accounts');
  await page.getByRole('button', { name: '添加账户', exact: true }).click();
  await page
    .getByRole('dialog', { name: '选择账户类型' })
    .getByRole('button', { name: '现金 随身现金、备用金', exact: true })
    .click();
  const account = page.getByRole('dialog', { name: '添加账户', exact: true });
  await account.getByLabel('账户名称').fill('虚构备注现金');
  await account.getByLabel('账户里有多少钱（元）').fill('1000');
  await account.getByLabel('从什么时候开始记').fill('2026-01-01T00:00');
  await account.getByRole('button', { name: '保存账户', exact: true }).click();
  await expect(account).toBeHidden();
  await page.goto('./#/');
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  const editor = page.getByRole('dialog', { name: '记一笔', exact: true });
  await editor.getByRole('button', { name: '付款账户', exact: true }).click();
  await page
    .getByRole('dialog', { name: '选择资金账户' })
    .getByRole('button', { name: '虚构备注现金', exact: true })
    .click();
  return editor;
}
test('手写备注金额与用途识别，确认前不覆盖，确认后保留日期和账户，保存重开仍准确', async ({ page }, info) => {
  const form = await setup(page);
  await form.getByLabel('金额', { exact: true }).fill('77.00');
  const date = await form.getByRole('button', { name: '修改发生时间', exact: true }).innerText();
  let previous = '77.00';
  for (const [text, amount, category] of [
    ['停车费10元', '10.00', '停车费'],
    ['停车费10块', '10.00', '停车费'],
    ['停车费 10 元', '10.00', '停车费'],
    ['泊车十块五', '10.50', '停车费'],
    ['地铁2号线 8', '8.00', '地铁'],
  ]) {
    await form.getByLabel('备注', { exact: true }).fill(text);
    await form.getByRole('button', { name: '识别备注', exact: true }).click();
    await expect(form.locator('.recognition-panel')).toContainText(`金额 ¥ ${amount} · 支出`);
    await expect(form.getByLabel('金额', { exact: true })).toHaveValue(previous);
    await form.getByRole('button', { name: '采用并继续核对', exact: true }).click();
    await expect(form.getByLabel('金额', { exact: true })).toHaveValue(amount);
    await expect(form.getByRole('button', { name: `当前分类：${category}`, exact: true })).toBeVisible();
    await expect(form.getByRole('button', { name: '修改发生时间', exact: true })).toHaveText(date);
    await expect(form.getByRole('button', { name: '付款账户', exact: true })).toContainText('虚构备注现金');
    await expect(form.getByLabel('备注', { exact: true })).toHaveValue(text);
    previous = amount;
  }
  await page.screenshot({ path: `artifacts/note-recognition-${info.project.name}.png` });
  await form.getByRole('button', { name: '保存账目', exact: true }).click();
  await page.goto('./#/accounts');
  await expect(page.getByRole('button', { name: '虚构备注现金，余额 ¥ 992.00', exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.getByRole('button', { name: '虚构备注现金，余额 ¥ 992.00', exact: true })).toBeVisible();
});
test('餐饮用途结合备注时间推荐早餐，原文金额和日期确认后采用，保留已选资金账户', async ({ page }) => {
  const form = await setup(page);
  await form.getByLabel('金额', { exact: true }).fill('77.00');
  await form
    .getByLabel('备注', { exact: true })
    .fill('尾号1234卡2026年10月14日08:20支出(消费财付通-示例包點店)6.80元，余额2,345.67元。【工商银行】');
  await form.getByRole('button', { name: '识别备注', exact: true }).click();
  const panel = form.locator('.recognition-panel');
  await expect(panel).toContainText('金额 ¥ 6.80 · 支出');
  await expect(panel).toContainText('按备注时间 08:20 推荐早餐');
  await expect(panel.getByRole('button', { name: '早餐', exact: true })).toBeVisible();
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('77.00');
  await form.getByRole('button', { name: '采用并继续核对', exact: true }).click();
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('6.80');
  await expect(form.getByRole('button', { name: '当前分类：早餐', exact: true })).toBeVisible();
  await expect(form.getByRole('button', { name: '修改发生时间', exact: true })).toContainText(
    '2026-10-14 08:20',
  );
  await expect(form.getByRole('button', { name: '付款账户', exact: true })).toContainText('虚构备注现金');
});
test('多个金额只选实际交易，编辑备注使旧预览失效，无效金额及保留手动填写不覆盖草稿', async ({ page }) => {
  const form = await setup(page);
  await form.getByLabel('金额', { exact: true }).fill('42.00');
  await form.getByLabel('备注', { exact: true }).fill('早餐10元，午餐20元，余额90元');
  await form.getByRole('button', { name: '识别备注', exact: true }).click();
  const panel = form.locator('.recognition-panel');
  await expect(panel).toContainText('金额 未识别');
  await expect(panel).toContainText('余额 ¥ 90.00');
  const choice = panel.getByRole('button', { name: '20元 · ¥ 20.00', exact: true });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [320, 393, 1024]) {
      await page.setViewportSize({ width, height: 700 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await panel.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    }
  }
  await choice.click();
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  await expect(panel).toContainText('金额 ¥ 20.00');
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('42.00');
  await form.getByLabel('备注', { exact: true }).fill('停车费12块');
  await expect(panel).toHaveCount(0);
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('42.00');
  await form.getByRole('button', { name: '识别备注', exact: true }).click();
  await form.getByRole('button', { name: '保留手动填写', exact: true }).click();
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('42.00');
  await form.getByRole('button', { name: '识别备注', exact: true }).click();
  await form.getByRole('button', { name: '采用并继续核对', exact: true }).click();
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('12.00');
  await form.getByLabel('备注', { exact: true }).fill('停车费1.234元');
  await form.getByRole('button', { name: '识别备注', exact: true }).click();
  await expect(panel).toContainText('金额 未识别');
  await form.getByRole('button', { name: '采用并继续核对', exact: true }).click();
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('12.00');
  await form.getByLabel('备注', { exact: true }).fill('早餐10元，午餐20元');
  await form.getByRole('button', { name: '识别备注', exact: true }).click();
  await panel.getByRole('button', { name: '20元 · ¥ 20.00', exact: true }).click();
  await form.getByRole('button', { name: '采用并继续核对', exact: true }).click();
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('20.00');
});

async function controlTime(page: Page) {
  const time = new Date('2026-10-30T12:00:00+08:00');
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.valueOf() + 1000));
}
async function encryptedSnapshot(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('BesLedger.encrypted.v1');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('vault'),
            read = tx.objectStore('vault').get('vault');
          read.onsuccess = () => resolve(JSON.stringify(read.result));
          tx.oncomplete = () => db.close();
        };
      }),
  );
}
test('自动识别合并输入并保护已填金额；手动输入和粘贴不触发，不改写加密账本', async ({ page }) => {
  const form = await setup(page),
    panel = form.locator('.recognition-panel');
  await controlTime(page);
  const before = await encryptedSnapshot(page);
  const toggle = form.getByRole('switch', { name: '自动识别备注', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await form.getByLabel('金额', { exact: true }).fill('77.00');
  await form.getByLabel('备注', { exact: true }).fill('停车费10元');
  await page.clock.runFor(1000);
  await expect(panel).toHaveCount(0);
  await toggle.click();
  await page.clock.runFor(200);
  await form.getByLabel('备注', { exact: true }).fill('停车费20元');
  await page.clock.runFor(349);
  await expect(panel).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(panel).toContainText('金额 ¥ 20.00');
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('77.00');
  await form.getByLabel('备注', { exact: true }).fill('停车费30元');
  await toggle.click();
  await page.clock.runFor(1000);
  await expect(panel).toHaveCount(0);
  await form.getByLabel('备注', { exact: true }).evaluate((element) => {
    const input = element as HTMLTextAreaElement;
    input.dispatchEvent(new Event('paste', { bubbles: true }));
    input.value = '停车费40元';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.clock.runFor(1000);
  await expect(panel).toHaveCount(0);
  await form.getByRole('button', { name: '识别备注', exact: true }).click();
  await expect(panel).toContainText('金额 ¥ 40.00');
  expect(await encryptedSnapshot(page)).toBe(before);
});
test('自动识别避开中文组词，采用或保留后不重弹，清空与离开取消未运行识别', async ({ page }) => {
  const form = await setup(page),
    note = form.getByLabel('备注', { exact: true }),
    panel = form.locator('.recognition-panel');
  await controlTime(page);
  await form.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  await note.dispatchEvent('compositionstart');
  await note.fill('停车费25元');
  await page.clock.runFor(1000);
  await expect(panel).toHaveCount(0);
  await note.dispatchEvent('compositionend');
  await page.clock.runFor(350);
  await expect(panel).toContainText('金额 ¥ 25.00');
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('25.00');
  await panel.locator('summary').click();
  await form.getByRole('button', { name: '保留当前填写', exact: true }).click();
  await page.clock.runFor(1000);
  await expect(panel).toHaveCount(0);
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('25.00');
  await note.fill('停车费26元');
  await page.clock.runFor(350);
  await panel.locator('summary').click();
  await form.getByRole('button', { name: '保留当前填写', exact: true }).click();
  await page.clock.runFor(1000);
  await expect(panel).toHaveCount(0);
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('26.00');
  await note.fill('停车费27元');
  await note.fill('');
  await page.clock.runFor(1000);
  await expect(panel).toHaveCount(0);
  await note.fill('停车费28元');
  await form.getByRole('button', { name: '返回', exact: true }).click();
  await page
    .getByRole('dialog', { name: '保留未保存草稿？', exact: true })
    .getByRole('button', { name: '放弃草稿', exact: true })
    .click();
  await page.clock.runFor(1000);
  await expect(form).toBeHidden();
  await expect(page.locator('.recognition-panel')).toHaveCount(0);
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  await expect(form.getByLabel('备注', { exact: true })).toHaveValue('');
  await expect(panel).toHaveCount(0);
});
test('自动识别快速保存直接保留手动金额和分类，不再要求重复采用', async ({ page }) => {
  const form = await setup(page);
  await form.getByLabel('金额', { exact: true }).fill('42.00');
  await form.getByRole('button', { name: '早餐', exact: true }).click();
  await form.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  await form.getByLabel('备注', { exact: true }).fill('停车费10元');
  await form.getByRole('button', { name: '保存账目', exact: true }).click();
  await expect(form).toBeHidden();
  await page.goto('./#/accounts');
  await expect(page.getByRole('button', { name: '虚构备注现金，余额 ¥ 958.00', exact: true })).toBeVisible();
});
test('识别模式在重开与刷新解锁后保持，编辑旧账不自动弹预览，输入后才识别', async ({ page }) => {
  const form = await setup(page);
  await form.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  await form.getByLabel('备注', { exact: true }).fill('停车费10元');
  await expect(form.locator('.recognition-panel')).toContainText('金额 ¥ 10.00');
  await form.getByRole('button', { name: '保存账目', exact: true }).click();
  await expect(form).toBeHidden();
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await page.getByRole('button').filter({ hasText: '停车费10元' }).click();
  await page.getByRole('button', { name: '编辑账目', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑账目', exact: true });
  await expect(edit.getByRole('switch', { name: '自动识别备注', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await controlTime(page);
  await page.clock.runFor(1000);
  await expect(edit.locator('.recognition-panel')).toHaveCount(0);
  await edit.getByLabel('备注', { exact: true }).fill('停车费11元');
  await page.clock.runFor(350);
  await expect(edit.locator('.recognition-panel')).toContainText('金额 ¥ 11.00');
  await expect(edit.getByLabel('金额', { exact: true })).toHaveValue('10.00');
  await edit.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [320, 393, 1024]) {
      await page.setViewportSize({ width, height: 700 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});

test('明确字段自动填入并跟随备注，手动金额、键盘和分类分别保护，清空也不重填', async ({ page }) => {
  const form = await setup(page),
    note = form.getByLabel('备注', { exact: true });
  await controlTime(page);
  await form.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  await note.fill('停车费10块');
  await page.clock.runFor(350);
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('10.00');
  await expect(form.getByRole('button', { name: '当前分类：停车费', exact: true })).toBeVisible();
  await expect(form.getByRole('button', { name: '采用并继续核对', exact: true })).toHaveCount(0);
  await expect(form.locator('.recognition-panel')).not.toHaveAttribute('open');
  await note.fill('午饭25元');
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('');
  await page.clock.runFor(350);
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('25.00');
  await expect(form.getByRole('button', { name: '当前分类：午餐', exact: true })).toBeVisible();
  await form.getByRole('button', { name: '删除末位金额', exact: true }).click();
  await form.locator('.entry-keypad').getByRole('button', { name: '5', exact: true }).click();
  await note.fill('地铁8元');
  await page.clock.runFor(350);
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('25.05');
  await expect(form.getByRole('button', { name: '当前分类：地铁', exact: true })).toBeVisible();
  await form.getByRole('button', { name: '早餐', exact: true }).click();
  await note.fill('买菜20元');
  await page.clock.runFor(350);
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('25.05');
  await expect(form.getByRole('button', { name: '当前分类：早餐', exact: true })).toBeVisible();
  await form.getByLabel('金额', { exact: true }).fill('');
  await note.fill('停车费31元');
  await page.clock.runFor(350);
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('');
});
test('多金额分类不猜，旧自动值撤回；逐项选择后直接保存，快速保存也不跳过歧义', async ({ page }) => {
  const form = await setup(page),
    note = form.getByLabel('备注', { exact: true });
  await controlTime(page);
  await form.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  await note.fill('停车费10元');
  await page.clock.runFor(350);
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('10.00');
  await note.fill('早餐10元，午餐20元');
  await form.getByRole('button', { name: '保存账目', exact: true }).click();
  const panel = form.locator('.recognition-panel');
  await expect(panel).toHaveAttribute('open');
  await expect(form.getByRole('alert')).toContainText('请先确认');
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('');
  await expect(form.getByRole('button', { name: '当前分类：未选择', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '20元 · ¥ 20.00', exact: true }).click();
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('20.00');
  await panel.getByRole('button', { name: '午餐', exact: true }).click();
  await expect(panel).not.toHaveAttribute('open');
  await form.getByRole('button', { name: '保存账目', exact: true }).click();
  await expect(form).toBeHidden();
  await page.goto('./#/accounts');
  await expect(page.getByRole('button', { name: '虚构备注现金，余额 ¥ 980.00', exact: true })).toBeVisible();
});
test('推断单位和年份仍确认，确认其余信息不覆盖后来手改的金额或分类', async ({ page }) => {
  const form = await setup(page),
    note = form.getByLabel('备注', { exact: true });
  await controlTime(page);
  await form.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  await note.fill('停车费10');
  await page.clock.runFor(350);
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('');
  await expect(form.locator('.recognition-panel')).toHaveAttribute('open');
  await note.fill('尾号1234卡10月14日08:20支出(消费财付通-示例包點店)6.80元，余额2,345.67元。【工商银行】');
  await page.clock.runFor(350);
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('6.80');
  await expect(form.getByRole('button', { name: '当前分类：早餐', exact: true })).toBeVisible();
  await expect(form.locator('.recognition-panel')).toContainText('请核对发生时间和年份');
  await form.getByLabel('金额', { exact: true }).fill('7.00');
  await form.getByRole('button', { name: '晚餐', exact: true }).click();
  await form.getByRole('button', { name: '确认其余信息', exact: true }).click();
  await expect(form.getByLabel('金额', { exact: true })).toHaveValue('7.00');
  await expect(form.getByRole('button', { name: '当前分类：晚餐', exact: true })).toBeVisible();
  await expect(form.getByRole('button', { name: '修改发生时间', exact: true })).toContainText(
    '2026-10-14 08:20',
  );
  await expect(form.getByRole('button', { name: '付款账户', exact: true })).toContainText('虚构备注现金');
});

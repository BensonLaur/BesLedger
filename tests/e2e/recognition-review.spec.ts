import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import type { StoredVault } from '../../src/storage/backend';
import { setEntryTime } from '../support/entry-time-ui';
let modules: ViteDevServer, row: StoredVault, manyRow: StoredVault, ambiguousRow: StoredVault;
test.use({ reducedMotion: 'reduce' });
test.beforeAll(async () => {
  modules = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const { accountPickerFixture } = await modules.ssrLoadModule('/tests/support/account-picker-fixture.ts');
  row = await accountPickerFixture('single');
  manyRow = await accountPickerFixture('many');
  ambiguousRow = await accountPickerFixture('ambiguous');
});
test.afterAll(async () => {
  await modules?.close();
});
async function open(page: Page, mode: 'single' | 'many' | 'ambiguous' = 'single') {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.clock.setFixedTime(new Date('2026-11-22T23:00:00+08:00'));
  await page.goto('./');
  await expect(page.getByRole('button', { name: '创建账本', exact: true })).toBeVisible();
  await page.evaluate(
    async (row) => {
      await new Promise<void>((resolve, reject) => {
        const r = indexedDB.open('BesLedger.encrypted.v1');
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction('vault', 'readwrite');
          tx.objectStore('vault').put(row);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        r.onerror = () => reject(r.error);
      });
    },
    mode === 'many' ? manyRow : mode === 'ambiguous' ? ambiguousRow : row,
  );
  await page.reload();
  // 等待读回注入的密文，避免与创建页同名密码框发生初始化竞态。
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  await page.getByLabel('解锁密码', { exact: true }).fill('fictional-picker-password');
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  return page.getByRole('dialog', { name: '记一笔', exact: true });
}
const review = (page: Page) => page.getByRole('dialog', { name: '备注识别结果', exact: true });
async function recognize(page: Page, note: string) {
  await page.getByLabel('备注', { exact: true }).fill(note);
  await page.getByRole('button', { name: '识别备注', exact: true }).click();
  return review(page);
}
async function bank(page: Page) {
  await page.getByRole('button', { name: '付款账户', exact: true }).click();
  await page
    .locator('.account-picker-backdrop')
    .getByRole('button', { name: '日常储蓄卡', exact: true })
    .click();
}

test('复制带退款的支出生成独立草稿，保留新日期，放弃不新增且保存不复制退款', async ({ page }) => {
  const form = await open(page);
  const note = '尾号1234卡2026年11月21日08:20停车费10元。【示例银行】';
  await form.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  await form.getByLabel('备注', { exact: true }).fill(note);
  await expect(form.getByRole('button', { name: '付款账户', exact: true })).toContainText('日常储蓄卡');
  await form.getByRole('button', { name: '保存账目', exact: true }).click();
  await expect(form).toBeHidden();

  const rows = page.locator('.entry-row').filter({ hasText: note });
  const detail = page.getByRole('dialog', { name: '账目详情', exact: true });
  await rows.click();
  await detail.getByRole('button', { name: '＋ 添加退款', exact: true }).click();
  await form.getByLabel('金额', { exact: true }).fill('2.00');
  await form.getByRole('button', { name: '保存账目', exact: true }).click();
  await expect(form).toBeHidden();
  await rows.click();
  await expect(detail).toContainText('关联退款 1 笔');

  await page.setViewportSize({ width: 320, height: 650 });
  const footer = detail.locator('.detail-actions');
  await expect(footer.getByRole('button')).toHaveText(['删除', '复制记一笔', '编辑账目']);
  const bounds = await footer.getByRole('button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const { left, right, top } = button.getBoundingClientRect();
      return { left, right, top };
    }),
  );
  expect(bounds.every((b) => b.left >= 0 && b.right <= 320 && b.top === bounds[0].top)).toBe(true);
  await footer.getByRole('button', { name: '删除', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: '删除账目', exact: true });
  await deletion.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(deletion.getByRole('alert')).toHaveText('请先删除关联退款，再删除原单');
  await deletion.getByRole('button', { name: '取消', exact: true }).click();

  const copy = page.getByRole('dialog', { name: '复制记一笔', exact: true });
  await footer.getByRole('button', { name: '复制记一笔', exact: true }).click();
  await expect(copy.getByLabel('备注', { exact: true })).toHaveValue(note);
  await expect(copy.getByLabel('金额', { exact: true })).toHaveValue('10.00');
  await expect(copy.getByRole('button', { name: '当前分类：停车费', exact: true })).toBeVisible();
  await expect(copy.getByRole('button', { name: '付款账户', exact: true })).toContainText('日常储蓄卡');
  await expect(copy.getByRole('button', { name: '修改发生时间', exact: true })).toHaveText('今天 23:00');
  await copy.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
  await expect(rows).toHaveCount(1);

  await page.getByRole('button', { name: '展开日历', exact: true }).click();
  await page.getByRole('button', { name: /^2026-11-21 / }).click();
  await rows.click();
  await detail.getByRole('button', { name: '复制记一笔', exact: true }).click();
  await expect(copy.getByRole('button', { name: '修改发生时间', exact: true })).toHaveText(
    '2026-11-21 12:00',
  );
  await copy.getByRole('button', { name: '保存账目', exact: true }).click();
  await expect(copy).toBeHidden();
  await expect(rows).toHaveCount(2);
  await rows.filter({ hasText: '12:00' }).click();
  await expect(detail).toContainText('2026-11-21 12:00:00');
  await expect(detail).toContainText('关联退款 0 笔');
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await rows.filter({ hasText: '08:20 ·' }).click();
  await expect(detail).toContainText('2026-11-21 08:20:00');
  await expect(detail).toContainText('关联退款 1 笔');
});

test('唯一尾号在分类和年份仍待核对时已填入主页面，关闭核对仍保留，保存重开账户正确', async ({ page }) => {
  const editor = await open(page);
  await editor.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  await editor
    .getByLabel('备注', { exact: true })
    .fill('尾号1234卡11月21日17:37支出(消费虚构商户)15元，余额1,200.00元。【示例银行】');
  const payment = editor.getByRole('button', { name: '付款账户', exact: true });
  await expect(payment).toContainText('日常储蓄卡');
  await editor.locator('.recognition-summary').click();
  await expect(review(page).locator('.review-task-heading')).toContainText('2 项');
  await expect(review(page).getByText('已自动选用', { exact: false })).toBeVisible();
  await review(page).getByRole('button', { name: '关闭', exact: true }).click();
  await expect(payment).toContainText('日常储蓄卡');
  await editor.locator('.recognition-summary').click();
  await review(page).locator('.review-fields').getByRole('button', { name: '选择分类', exact: true }).click();
  await review(page).getByLabel('搜索分类').fill('停车费');
  await review(page).getByRole('button', { name: '停车费', exact: true }).click();
  await review(page).getByRole('button', { name: '完成核对', exact: true }).click();
  await editor.getByRole('button', { name: '保存账目', exact: true }).click();
  await expect(editor).toBeHidden();
  await page.reload();
  // 等待读回注入的密文，避免与创建页同名密码框发生初始化竞态。
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  await page.getByLabel('解锁密码', { exact: true }).fill('fictional-picker-password');
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await page.goto('./#/accounts');
  await expect(page.locator('.assets-total')).toContainText('985.00');
});

test('自动账户跟随唯一匹配，核对其他字段后仍可跟随，未知尾号或清空撤回旧自动账户', async ({ page }) => {
  const editor = await open(page);
  await editor.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  const note = editor.getByLabel('备注', { exact: true });
  const payment = editor.getByRole('button', { name: '付款账户', exact: true });
  await note.fill('尾号1234卡2026年11月21日08:20停车费10元。【示例银行】');
  await expect(payment).toContainText('日常储蓄卡');
  await editor.locator('.recognition-summary').click();
  await review(page).getByRole('button', { name: '完成核对', exact: true }).click();
  await note.fill('尾号5678卡停车费12元');
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('12.00');
  await expect(payment).toContainText('选择账户');
  await note.fill('尾号1234卡停车费13元');
  await expect(payment).toContainText('日常储蓄卡');
  await note.fill('');
  await expect(payment).toContainText('选择账户');
});

test('手选账户不被匹配尾号或清空备注覆盖，核对面板展示实际保留的账户', async ({ page }) => {
  const editor = await open(page, 'many');
  await editor.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  const note = editor.getByLabel('备注', { exact: true });
  const payment = editor.getByRole('button', { name: '付款账户', exact: true });
  await note.fill('尾号1234卡停车费10元');
  await expect(payment).toContainText('日常储蓄卡');
  await payment.click();
  await page
    .locator('.account-picker-backdrop')
    .getByRole('button', { name: '随身现金', exact: true })
    .click();
  await note.fill('尾号1234卡停车费12元');
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('12.00');
  await expect(payment).toContainText('随身现金');
  await editor.locator('.recognition-summary').click();
  await expect(review(page).locator('.review-fields')).toContainText('随身现金');
  await expect(review(page).locator('.review-fields')).toContainText('保留已选账户');
  await review(page).getByRole('button', { name: '关闭', exact: true }).click();
  await note.fill('');
  await expect(payment).toContainText('随身现金');
});

test('两个同银行同尾号账户不自动选择，在核对面板明确展示歧义', async ({ page }) => {
  const editor = await open(page, 'ambiguous');
  await editor.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  await editor
    .getByLabel('备注', { exact: true })
    .fill('尾号1234卡2026年11月21日08:20停车费10元。【示例银行】');
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('10.00');
  await expect(editor.getByRole('button', { name: '付款账户', exact: true })).toContainText('选择账户');
  await editor.locator('.recognition-summary').click();
  await expect(review(page)).toContainText('匹配多个账户，请选择');
});

test('收入唯一尾号自动填收款账户，不要求先点采用', async ({ page }) => {
  const editor = await open(page);
  await editor.getByRole('button', { name: '收入', exact: true }).click();
  await editor.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  await editor
    .getByLabel('备注', { exact: true })
    .fill('尾号1234卡2026年11月21日10:20收入(工资薪水)100元。【示例银行】');
  await expect(editor.getByRole('button', { name: '收款账户', exact: true })).toContainText('日常储蓄卡');
  await expect(review(page)).toHaveCount(0);
});

test('自动识别立即填入完整时间，不用采用即可保存，刷新重开仍是交易时间', async ({ page }) => {
  const editor = await open(page);
  await bank(page);
  await editor.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  const text = '2026年11月21日08:20停车费10元';
  await editor.getByLabel('备注', { exact: true }).fill(text);
  await expect(editor.getByRole('button', { name: '修改发生时间', exact: true })).toContainText(
    '2026-11-21 08:20',
  );
  await expect(editor.locator('.recognition-summary')).toContainText('时间');
  await expect(review(page)).toHaveCount(0);
  await editor.getByRole('button', { name: '保存账目', exact: true }).click();
  await expect(editor).toBeHidden();
  await page.reload();
  // 等待读回注入的密文，避免与创建页同名密码框发生初始化竞态。
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  await page.getByLabel('解锁密码', { exact: true }).fill('fictional-picker-password');
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await page.getByRole('button').filter({ hasText: text }).click();
  await expect(page.getByRole('dialog')).toContainText('2026-11-21 08:20');
});

test('缺少年份先更新候选时间但保存仍核对，手调后不被新备注覆盖', async ({ page }) => {
  const editor = await open(page);
  await bank(page);
  await editor.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  const note = editor.getByLabel('备注', { exact: true });
  const time = editor.getByRole('button', { name: '修改发生时间', exact: true });
  await note.fill('10月14日08:20停车费10元');
  await expect(time).toContainText('2026-10-14 08:20');
  await editor.getByRole('button', { name: '保存账目', exact: true }).click();
  await expect(review(page).getByText('年份待确认', { exact: true })).toBeVisible();
  await review(page).getByRole('button', { name: '关闭', exact: true }).click();
  await expect(time).toContainText('2026-10-14 08:20');
  await time.click();
  const picker = page.getByRole('dialog', { name: '发生时间', exact: true });
  await setEntryTime(picker, '2025-10-13T09:25');
  await picker.getByRole('button', { name: '确定', exact: true }).click();
  await note.fill('2026年11月20日18:40停车费12元');
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('12.00');
  await expect(time).toContainText('2025-10-13 09:25');
  await editor.locator('.recognition-summary').click();
  await expect(review(page).getByText('保留手动时间', { exact: true })).toBeVisible();
});

test('备注删除日期、日期无效或多时间时撤回旧自动时间，异常日期保存前仍需核对', async ({ page }) => {
  const editor = await open(page);
  await bank(page);
  await editor.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  const note = editor.getByLabel('备注', { exact: true });
  const time = editor.getByRole('button', { name: '修改发生时间', exact: true });
  const initial = await time.innerText();
  for (const [text, warning] of [
    ['停车费12元', ''],
    ['2026年2月30日08:20停车费12元', '原文日期无效'],
    ['2027年1月1日08:20停车费12元', '晚于今天'],
    ['2026年10月14日08:20停车费12元，通知时间2026年10月15日09:30', '多个时间'],
  ]) {
    await note.fill('2026年11月21日08:20停车费10元');
    await expect(time).toContainText('2026-11-21 08:20');
    await note.fill(text);
    await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('12.00');
    await expect(time).toHaveText(initial);
    if (warning) {
      await editor.getByRole('button', { name: '保存账目', exact: true }).click();
      await expect(review(page).locator('.review-field.pending')).toContainText(warning);
      await review(page).getByRole('button', { name: '保留我的填写', exact: true }).click();
    }
  }
  await note.fill('2026年11月21日08:20停车费10元');
  await expect(time).toContainText('2026-11-21 08:20');
  await note.fill('');
  await expect(time).toHaveText(initial);
});

test('缺分类与推断年份突出，详情默认收起；直接补齐后保存，不把短信余额写到账户', async ({ page }) => {
  const editor = await open(page);
  const dialog = await recognize(
    page,
    '尾号1234卡11月22日17:37支出(消费虚构商户)15元，余额1,200.00元。【示例银行】',
  );
  await expect(dialog.getByLabel('本次金额')).toHaveValue('15.00');
  await expect(dialog.locator('.review-task-heading')).toContainText('2 项');
  await expect(dialog.locator('.review-field.pending')).toHaveCount(2);
  await expect(dialog.getByText('年份待确认', { exact: true })).toBeVisible();
  await expect(dialog.locator('.review-details')).not.toHaveAttribute('open', '');
  await expect(dialog.getByText(/备注中的余额 ¥/)).toBeHidden();
  expect((await dialog.boundingBox())!.height).toBeLessThan(560);
  await dialog.locator('.review-fields').getByRole('button', { name: '选择分类', exact: true }).click();
  await dialog.getByLabel('搜索分类').fill('停车费');
  await dialog.getByRole('button', { name: '停车费', exact: true }).click();
  await dialog.getByRole('button', { name: '确认 2026 年', exact: true }).click();
  await dialog.getByRole('button', { name: '采用并返回', exact: true }).click();
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('15.00');
  await expect(editor.getByRole('button', { name: '当前分类：停车费', exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: '修改发生时间', exact: true })).toContainText('17:37');
  await editor.getByRole('button', { name: '保存账目', exact: true }).click();
  await expect(editor).toBeHidden();
  await page.goto('./#/accounts');
  await expect(page.locator('.assets-total')).toContainText('985.00');
});

test('候选和日期修改先留在核对面板，关闭或保留填写不改原草稿', async ({ page }) => {
  const editor = await open(page);
  await bank(page);
  await editor.getByLabel('金额', { exact: true }).fill('77.00');
  await editor.getByRole('button', { name: '午餐', exact: true }).click();
  const beforeTime = await editor.getByRole('button', { name: '修改发生时间', exact: true }).innerText();
  const dialog = await recognize(page, '早餐10元，午餐20元');
  await dialog.getByRole('button', { name: '20元 · ¥ 20.00', exact: true }).click();
  await dialog.getByRole('button', { name: '早餐', exact: true }).click();
  await dialog.getByRole('button', { name: '修改时间', exact: true }).click();
  const time = page.getByRole('dialog', { name: '发生时间', exact: true });
  await setEntryTime(time, '2025-10-02T08:20');
  await time.getByRole('button', { name: '确定', exact: true }).click();
  await expect(dialog.getByLabel('本次金额')).toHaveValue('20.00');
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('77.00');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('77.00');
  await expect(editor.getByRole('button', { name: '当前分类：午餐', exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: '修改发生时间', exact: true })).toHaveText(beforeTime);
  await page.locator('.recognition-summary').click();
  await expect(dialog.getByLabel('本次金额')).toHaveValue('77.00');
  await dialog.getByRole('button', { name: '保留我的填写', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('自动模式突出实际保留的手填金额和分类，来源折叠，确认其余字段不覆盖它们', async ({ page }) => {
  const editor = await open(page);
  await bank(page);
  await editor.getByLabel('金额', { exact: true }).fill('77.00');
  await editor.getByRole('button', { name: '早餐', exact: true }).click();
  await editor.getByRole('switch', { name: '自动识别备注', exact: true }).click();
  await editor
    .getByLabel('备注', { exact: true })
    .fill('尾号1234卡11月22日17:37支出(消费虚构商户)15元。【示例银行】');
  await expect(page.locator('.recognition-summary')).toBeVisible();
  await editor.getByRole('button', { name: '完成备注', exact: true }).click();
  await page.locator('.recognition-summary').click();
  const dialog = review(page);
  await expect(dialog.getByLabel('本次金额')).toHaveValue('77.00');
  await expect(dialog).toContainText('保留手填金额');
  await expect(dialog.locator('.review-fields')).toContainText('保留手动选择');
  await expect(dialog.locator('.review-details').getByText(/识别金额 ¥ 15.00/)).toBeHidden();
  await dialog.getByRole('button', { name: '完成核对', exact: true }).click();
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('77.00');
  await expect(editor.getByRole('button', { name: '当前分类：早餐', exact: true })).toBeVisible();
});

test('缺账户可直接打开选择器，关键交易风险始终可见', async ({ page }) => {
  const editor = await open(page);
  let dialog = await recognize(page, '停车费10元');
  await dialog.locator('.review-actions').getByRole('button', { name: '选择账户', exact: true }).click();
  await page
    .locator('.account-picker-backdrop')
    .getByRole('button', { name: '日常储蓄卡', exact: true })
    .click();
  await dialog.getByRole('button', { name: '采用并返回', exact: true }).click();
  for (const [text, warning] of [
    ['停车费10美元', '当前仅支持人民币'],
    ['计划花10元吃午餐', '未完成的交易'],
    ['退款20元', '退款需选择原支出'],
  ]) {
    dialog = await recognize(page, text);
    await expect(dialog.locator('.review-critical').filter({ hasText: warning })).toBeVisible();
    await dialog.getByRole('button', { name: '保留我的填写', exact: true }).click();
    await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('10.00');
    await expect(editor.getByRole('button', { name: '支出', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
});

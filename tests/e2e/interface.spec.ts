import { expect, test, type Page } from '@playwright/test';
async function initialize(page: Page) {
  await page.goto('./');
  await page.getByLabel('账本名称').fill('虚构界面验收账本');
  await page.getByLabel('解锁密码', { exact: true }).fill('fictional-interface-password');
  await page.getByLabel('再次输入密码', { exact: true }).fill('fictional-interface-password');
  await page.getByRole('button', { name: '创建账本' }).click();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本' }).click();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => {
      const containers = [
        document.documentElement,
        ...document.querySelectorAll<HTMLElement>('.modal-content, .page, .account-fields-card'),
      ];
      return containers.filter((e) => e.clientWidth > 0).every((e) => e.scrollWidth <= e.clientWidth + 1);
    }),
  ).toBe(true);
  expect(
    await page.locator('input, textarea, select').evaluateAll((elements) =>
      elements
        .filter((e) => e.getClientRects().length)
        .every((e) => {
          const r = e.getBoundingClientRect();
          return r.left >= -1 && r.right <= innerWidth + 1;
        }),
    ),
  ).toBe(true);
}
async function openAccount(page: Page, type: string) {
  if (new URL(page.url()).hash !== '#/accounts') await page.goto('./#/accounts');
  await page.getByRole('button', { name: '添加账户', exact: true }).click();
  await page.getByRole('dialog', { name: '选择账户类型' }).getByRole('button', { name: type }).click();
  return page.getByRole('dialog', { name: '添加账户', exact: true });
}
test('手机五个对称入口、当前页反馈和中心返回首页', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await initialize(page);
  const nav = page.getByRole('navigation', { name: '底部导航' });
  await expect(nav.locator(':scope > *')).toHaveCount(5);
  await expect(nav).toHaveText('账户事件记一笔统计我的');
  for (const name of ['账户', '事件', '统计', '我的']) {
    await nav.getByRole('link', { name, exact: true }).click();
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: '首页' })).toBeVisible();
    const selected = nav.getByRole('link', { name, exact: true });
    // 选中状态有 140ms 过渡，等待实际绘制，避免在首帧误判为透明。
    await expect
      .poll(() => selected.evaluate((e) => getComputedStyle(e).backgroundColor))
      .not.toBe('rgba(0, 0, 0, 0)');
    await noOverflow(page);
  }
  await nav.getByRole('link', { name: '首页' }).click();
  await expect(nav.getByRole('button', { name: '记一笔' })).toBeVisible();
});
test('所有账户类型在小屏和深浅色均不横向滚动，切换保留各自草稿', async ({ page }, info) => {
  await initialize(page);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const width of [320, 393]) {
      await page.setViewportSize({ width, height: 852 });
      if (new URL(page.url()).hash !== '#/accounts') await page.goto('./#/accounts');
      await page.getByRole('button', { name: '添加账户', exact: true }).click();
      const chooser = page.getByRole('dialog', { name: '选择账户类型' });
      await noOverflow(page);
      for (const name of [
        '现金',
        '信用卡',
        '储蓄卡 / 借记卡',
        '网络账户',
        '投资账户',
        '应收 / 应付',
        '储值卡',
        '其他账户',
      ]) {
        await chooser.getByRole('button', { name: new RegExp('^' + name) }).click();
        const form = page.getByRole('dialog', { name: '添加账户', exact: true });
        await form.getByLabel(name === '应收 / 应付' ? '对方怎么称呼' : '账户名称').fill('虚构' + name);
        await noOverflow(page);
        await form.getByRole('button', { name: '更换类型' }).click();
      }
      await chooser.getByRole('button', { name: '现金 随身现金、备用金' }).click();
      await expect(page.getByLabel('账户名称')).toHaveValue('虚构现金');
      await page.getByRole('dialog').screenshot({
        path: `artifacts/account-form-${info.project.name}-${width}-${scheme}.png`,
        animations: 'disabled',
      });
      await page.getByRole('button', { name: '返回', exact: true }).click();
      await chooser.getByRole('button', { name: '返回', exact: true }).click();
    }
  }
});
test('信用卡和往来用生活语言表达方向，编辑和重启不反转余额', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await initialize(page);
  for (const item of [
    {
      type: '信用卡 消费欠款、还款与退款',
      name: '虚构欠款卡',
      direction: '还有钱没还',
      label: '还欠多少钱（元）',
      value: '123.45',
      expected: '待还款',
    },
    {
      type: '信用卡 消费欠款、还款与退款',
      name: '虚构余款卡',
      direction: '卡里有多存的钱',
      label: '卡里多存的钱（元）',
      value: '56.78',
      expected: '卡内余款',
    },
    {
      type: '应收 / 应付 别人欠我的钱、我欠别人的钱',
      name: '虚构朋友甲',
      direction: '我欠别人的钱',
      label: '我欠对方多少钱（元）',
      value: '88.00',
      expected: '我欠别人',
    },
    {
      type: '应收 / 应付 别人欠我的钱、我欠别人的钱',
      name: '虚构朋友乙',
      direction: '别人欠我的钱',
      label: '对方欠我多少钱（元）',
      value: '66.00',
      expected: '别人欠我',
    },
  ]) {
    const form = await openAccount(page, item.type);
    await form.getByLabel(item.name.includes('朋友') ? '对方怎么称呼' : '账户名称').fill(item.name);
    await form.getByRole('button', { name: item.direction, exact: true }).click();
    await form.getByLabel(item.label, { exact: true }).fill(item.value);
    await form.getByRole('button', { name: '保存账户' }).click();
    const row = page.getByRole('button', {
      name: `${item.name}，${item.expected} ¥ ${item.value}`,
      exact: true,
    });
    await expect(row).toBeVisible();
    await row.click();
    await page.getByRole('button', { name: '编辑账户', exact: true }).click();
    await expect(page.getByLabel(item.label, { exact: true })).toHaveValue(item.value);
    await expect(page.getByRole('button', { name: item.direction, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: '保存账户' }).click();
    await page.getByRole('button', { name: '返回账户列表' }).click();
    await expect(row).toBeVisible();
  }
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill('fictional-interface-password');
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.getByRole('button', { name: '虚构欠款卡，待还款 ¥ 123.45' })).toBeVisible();
  await expect(page.getByRole('button', { name: '虚构朋友甲，我欠别人 ¥ 88.00' })).toBeVisible();
});
test('分类图标和选中名称一致，数字键盘精度、连续保存和选择器返回', async ({ page }, info) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await initialize(page);
  const form = await openAccount(page, '现金 随身现金、备用金');
  await form.getByLabel('账户名称').fill('虚构现金');
  await form.getByLabel('账户里有多少钱（元）').fill('1000');
  await form.getByRole('button', { name: '保存账户' }).click();
  await page.goto('./#/');
  await page.getByRole('button', { name: '记一笔', exact: true }).filter({ visible: true }).click();
  const editor = page.getByRole('dialog', { name: '记一笔', exact: true });
  await expect(editor.getByRole('button', { name: '当前分类：未选择' })).toBeVisible();
  await editor.getByRole('button', { name: '午餐', exact: true }).click();
  await expect(editor.getByRole('button', { name: '当前分类：午餐' })).toBeVisible();
  await expect(editor.getByRole('button', { name: '午餐', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await editor.getByRole('button', { name: '午餐', exact: true }).locator('svg').innerHTML()).not.toBe(
    await editor.getByRole('button', { name: '早餐', exact: true }).locator('svg').innerHTML(),
  );
  for (const digit of ['1', '2', '.', '3', '4', '5'])
    await editor.locator('.entry-keypad').getByRole('button', { name: digit, exact: true }).click();
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('12.34');
  await editor.getByRole('button', { name: '修改发生时间' }).click();
  await expect(page.getByRole('dialog', { name: '发生时间', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '发生时间', exact: true })).toBeHidden();
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: '付款账户', exact: true }).click();
  await page.getByRole('dialog', { name: '选择资金账户' }).getByRole('button', { name: '虚构现金' }).click();
  await noOverflow(page);
  await editor.locator('.modal-content').evaluate((e) => (e.scrollTop = 0));
  await page.screenshot({ path: `artifacts/entry-aligned-${info.project.name}.png`, animations: 'disabled' });
  await editor.getByRole('button', { name: '保存并再记' }).click();
  await expect(editor.getByLabel('金额', { exact: true })).toHaveValue('');
  await editor.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByText('−12.34', { exact: true })).toBeVisible();
  if (new URL(page.url()).hash !== '#/accounts') await page.goto('./#/accounts');
  await expect(page.getByRole('button', { name: '虚构现金，余额 ¥ 987.66' })).toBeVisible();
});

test('我的首屏区分本地解锁与未连接，帮助按需展开且密钥用途明确', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await initialize(page);
  await page.goto('./#/settings');
  await expect(
    page.locator('.settings-profile').getByText('账目在此浏览器中加密保存', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.connection-summary')).toContainText('未登录');
  await expect(page.locator('.connection-details')).toHaveCount(0);
  await page.locator('.connection-summary').click();
  await expect(page.getByText(/授权范围包含你账号内其他仓库/)).toBeVisible();
  await page
    .getByRole('dialog', { name: '跨设备同步' })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.getByRole('button', { name: /查看与保存恢复密钥/ }).click();
  await page.getByText('这份密钥适用于哪些账本？', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: '查看与保存恢复密钥' })).toContainText(
    '不一定能解密从其他设备下载的账本',
  );
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByText('记账、登录与同步有什么区别？', { exact: true }).click();
  await expect(
    page.getByText('记住登录和密钥不会自动上传。修改后点击账本的“同步”，另一设备再同步获取更新。'),
  ).toBeVisible();
  await noOverflow(page);
});

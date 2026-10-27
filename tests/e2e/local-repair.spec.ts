import { expect, test } from '@playwright/test';
test.use({ reducedMotion: 'reduce' });
test('只有当前数据损坏且密码可验证备用副本时才显示修复，取消不改数据', async ({ page }) => {
  const password = 'fictional-local-repair-password';
  await page.goto('./#/settings');
  await page.getByLabel('账本名称').fill('虚构本地修复账本');
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByLabel('再次输入密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账本', exact: true }).click();
  await page.getByLabel('我已独立保存恢复密钥').check();
  await page.getByRole('button', { name: '进入账本', exact: true }).click();
  await page.goto('./#/accounts');
  await page.getByRole('button', { name: '添加账户', exact: true }).click();
  await page
    .getByRole('dialog', { name: '选择账户类型' })
    .getByRole('button', { name: '现金 随身现金、备用金' })
    .click();
  await page.getByLabel('账户名称').fill('虚构最近新增账户');
  await page.getByRole('button', { name: '保存账户', exact: true }).click();
  await page.goto('./#/settings');
  await page.getByRole('button', { name: '锁定', exact: true }).click();
  const stored = (damage = false) =>
    page.evaluate(
      (damage) =>
        new Promise<string>((resolve, reject) => {
          const request = indexedDB.open('BesLedger.encrypted.v1');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result,
              tx = db.transaction('vault', damage ? 'readwrite' : 'readonly'),
              table = tx.objectStore('vault'),
              read = table.get('vault');
            let result: string;
            read.onsuccess = () => {
              const row = read.result;
              if (damage) {
                const archive = JSON.parse(row.payload),
                  bytes = atob(archive.data.ciphertext);
                archive.data.ciphertext = btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1));
                row.payload = JSON.stringify(archive);
                table.put(row);
              }
              result = JSON.stringify(row);
            };
            tx.oncomplete = () => {
              db.close();
              resolve(result);
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      damage,
    );
  const before = await stored(true);
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill('fictional-wrong-password');
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请检查解锁密码');
  await expect(page.getByRole('button', { name: '查看本地备用副本', exact: false })).toHaveCount(0);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByLabel('解锁密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '打开账本', exact: true }).click();
    await page.getByRole('button', { name: '查看本地备用副本', exact: false }).click();
    await expect(page.getByText('1 本账本、0 个账户、0 笔账目', { exact: true })).toBeVisible();
    expect(await stored()).toBe(before);
    if (attempt === 0) {
      await page.getByRole('button', { name: '返回解锁', exact: true }).click();
      await expect(page.getByRole('button', { name: '查看本地备用副本', exact: false })).toHaveCount(0);
    }
  }
  await page.getByRole('button', { name: '确认使用备用副本', exact: true }).click();
  expect(await stored()).toBe(before);
  await page.getByLabel('我确认使用这份本地备用副本恢复').check();
  await page.getByRole('button', { name: '确认使用备用副本', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的', exact: true })).toBeVisible();
  await page.goto('./#/accounts');
  await expect(page.getByText('虚构最近新增账户', { exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByLabel('解锁密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '打开账本', exact: true }).click();
  await page.goto('./#/');
  await expect(page.getByText('虚构本地修复账本', { exact: true })).toBeVisible();
});

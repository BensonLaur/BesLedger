import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function stored(page: Page) {
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

test('真实离线资源更新在锁定页可见，未完成填写与密钥保存时阻止刷新，更新保留账本', async ({ page }) => {
  test.setTimeout(60000);
  const root = path.resolve('dist');
  let version = 1;
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.webmanifest': 'application/manifest+json',
  };
  // 独立端口仅改变 Worker 的测试版本注释，不修改 dist，也不访问用户的预览存储。
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname);
      if (!pathname.startsWith('/BesLedger/')) {
        response.writeHead(404).end();
        return;
      }
      const relative = pathname.slice('/BesLedger/'.length) || 'index.html';
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep)) {
        response.writeHead(404).end();
        return;
      }
      let bytes = await readFile(file);
      if (relative === 'sw.js')
        bytes = Buffer.concat([Buffer.from(`// fictional-worker-revision-${version}\n`), bytes]);
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/BesLedger/`;
  try {
    await page.goto(url);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await page.getByLabel('账本名称').fill('虚构更新验收账本');
    await page.getByLabel('解锁密码', { exact: true }).fill('fictional-update-password');
    await page.getByLabel('再次输入密码', { exact: true }).fill('fictional-update-password');
    version++;
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())!.update();
    });
    const update = page.getByRole('button', { name: '更新并重新打开', exact: true });
    await expect(update).toBeVisible({ timeout: 15000 });
    await expect(update).toBeDisabled();
    await expect(page.getByLabel('账本名称')).toHaveValue('虚构更新验收账本');
    await page.getByRole('button', { name: '创建账本', exact: true }).click();
    await expect(page.getByRole('heading', { name: '保存恢复密钥' })).toBeVisible();
    await expect(update).toBeDisabled();
    await page.getByLabel('我已独立保存恢复密钥').check();
    await page.getByRole('button', { name: '进入账本', exact: true }).click();
    await page.goto(url + '#/settings');
    await page.getByRole('button', { name: '校验并恢复备份', exact: false }).click();
    await expect(page.locator('.app-update button')).toBeDisabled();
    await page
      .getByRole('dialog', { name: '恢复完整备份', exact: true })
      .getByRole('button', { name: '关闭', exact: true })
      .click();
    await expect(update).toBeEnabled();
    await page.getByRole('button', { name: '锁定', exact: true }).click();
    await expect(update).toBeEnabled();
    const before = await stored(page);
    await page.getByLabel('解锁密码', { exact: true }).fill('fictional-unfinished-input');
    await expect(update).toBeDisabled();
    await page.getByLabel('解锁密码', { exact: true }).fill('');
    await expect(update).toBeEnabled();
    await Promise.all([page.waitForEvent('load'), update.click()]);
    await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
    await expect(update).toHaveCount(0);
    expect(await stored(page)).toBe(before);
    await page.getByLabel('解锁密码', { exact: true }).fill('fictional-update-password');
    await page.getByRole('button', { name: '打开账本', exact: true }).click();
    await page.goto(url + '#/');
    await expect(page.getByText('虚构更新验收账本', { exact: true })).toBeVisible();
  } finally {
    await page.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
});

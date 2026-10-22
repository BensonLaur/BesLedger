import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { WebBackend } from '../src/storage/backend';
import { Vault } from '../src/storage/vault';
import { decrypt, encrypt, importKey, parseRecovery } from '../src/crypto/vault';
import { put, type Binding } from '../src/domain/model';
import { ledgerProjection } from '../src/sync/merge';

const password = 'fictional-sync-key-password';
const foreign = '12'.repeat(32),
  replacement = '34'.repeat(32);
const binding: Binding = { owner: 'fictional-owner', repo: 'BesLedger-Data', userId: 42, remoteExists: true };
async function setup() {
  const disk = new WebBackend(crypto.randomUUID());
  const vault = new Vault(disk);
  await vault.create(password);
  await vault.mutate((s) => put(s, { kind: 'ledger', name: '虚构设备密钥验收' }, 'book'));
  return { disk, vault };
}
async function remember(vault: Vault, value = foreign, id = 'book') {
  const lease = await vault.prepareSyncKey(id, binding, value);
  // 模拟已完成远端解密后的提交边界，UI 的真实解密顺序另由浏览器测试覆盖。
  await vault.rememberSyncKey(lease, () => undefined);
}
async function canDecrypt(vault: Vault, value = foreign, id = 'book') {
  const message = await encrypt('虚构验证文本', await importKey(parseRecovery(value)), 'probe');
  const lease = await vault.prepareSyncKey(id, binding);
  expect(await decrypt(message, lease.key, 'probe')).toBe('虚构验证文本');
  expect(lease.key.extractable).toBe(false);
}
describe('设备保存的同步密钥', () => {
  it('外部密钥加密落盘，重启与锁定解锁恢复，不进入业务状态、云端投影或导出备份', async () => {
    const { disk, vault } = await setup();
    await remember(vault);
    const archive = JSON.parse((await disk.read())!.payload);
    expect(Object.keys(archive.deviceSyncKeys)).toHaveLength(1);
    expect(JSON.stringify(archive).includes(foreign)).toBe(false);
    const envelope = Object.values(archive.deviceSyncKeys)[0];
    await expect(
      decrypt(envelope, vault.encryptionKey, 'local-state').then(() => undefined),
    ).rejects.toThrow();
    const backup = JSON.parse(await vault.exportBackup());
    expect(backup.deviceSyncKeys).toBeUndefined();
    expect(
      JSON.stringify(await decrypt(backup.data, vault.encryptionKey, 'local-state')).includes(foreign),
    ).toBe(false);
    expect(JSON.stringify(ledgerProjection(vault.state!, 'book')).includes(foreign)).toBe(false);
    const oldLease = await vault.prepareSyncKey('book', binding);
    vault.lock();
    expect(() => oldLease.assertCurrent()).toThrow('锁定');
    await expect(vault.prepareSyncKey('book', binding)).rejects.toThrow('解锁');
    const reopened = new Vault(disk);
    await reopened.unlock(password);
    await canDecrypt(reopened);
    reopened.lock();
    await reopened.unlock(password);
    await canDecrypt(reopened);
  });
  it('按账号、仓库和账本隔离；未验证输入不替换已保存副本', async () => {
    const { vault } = await setup();
    await remember(vault);
    for (const [id, target] of [
      ['other-book', binding],
      ['book', { ...binding, userId: 43 }],
      ['book', { ...binding, repo: 'Other' }],
      ['book', { ...binding, owner: 'another-owner' }],
    ] as const)
      await expect(vault.prepareSyncKey(id, target)).rejects.toThrow('首次下载');
    const wrong = await vault.prepareSyncKey('book', binding, replacement);
    const validMessage = await encrypt('test', await importKey(parseRecovery(foreign)), 'probe');
    await expect(decrypt(validMessage, wrong.key, 'probe').then(() => undefined)).rejects.toThrow();
    await canDecrypt(vault);
    await remember(vault, replacement);
    await canDecrypt(vault, replacement);
  });
  it('首次上传自动采用本机密钥，旧归档无需升级或清库', async () => {
    const { disk, vault } = await setup();
    expect(JSON.parse((await disk.read())!.payload).deviceSyncKeys).toBeUndefined();
    const old = new Vault(disk);
    await old.unlock(password);
    const lease = await old.prepareSyncKey('book', binding, '', true);
    expect(lease.source).toBe('local');
    const message = await encrypt('same key', vault.encryptionKey, 'probe');
    expect(await decrypt(message, lease.key, 'probe')).toBe('same key');
    await old.rememberSyncKey(lease, () => undefined);
    expect((await old.prepareSyncKey('book', binding)).source).toBe('saved');
  });
  it('忘记、锁定或恢复空间后，迟到请求不能重新保存旧密钥', async () => {
    const { vault } = await setup();
    await remember(vault);
    const pending = await vault.prepareSyncKey('book', binding);
    await vault.forgetSyncKey('book', binding);
    await expect(vault.rememberSyncKey(pending, () => undefined)).rejects.toThrow('已改变');
    expect(await vault.hasSyncKey('book', binding)).toBe(false);
    await remember(vault);
    const beforeLock = await vault.prepareSyncKey('book', binding);
    vault.lock();
    await vault.unlock(password);
    await expect(vault.rememberSyncKey(beforeLock, () => undefined)).rejects.toThrow('空间已改变');
    const beforeRestore = await vault.prepareSyncKey('book', binding);
    await vault.restore(await vault.exportBackup(), password, password);
    await expect(vault.rememberSyncKey(beforeRestore, () => undefined)).rejects.toThrow('空间已改变');
    expect(await vault.hasSyncKey('book', binding)).toBe(false);
  });
  it('并发保存通过 CAS 拒绝旧窗口覆盖，普通记账保留密钥', async () => {
    const { disk, vault } = await setup();
    const other = new Vault(disk);
    await other.unlock(password);
    await remember(vault);
    await expect(remember(other, replacement)).rejects.toThrow('另一个窗口');
    await other.unlock(password);
    await other.mutate((s) => put(s, { kind: 'ledger', name: '虚构新账本' }, 'new-book'));
    const reopened = new Vault(disk);
    await reopened.unlock(password);
    await canDecrypt(reopened);
    expect(reopened.state!.entities['new-book']).toBeDefined();
  });
  it('备份与上一版本只恢复账目，不恢复已经忘记的设备密钥', async () => {
    const { vault } = await setup();
    await remember(vault);
    const backup = await vault.exportBackup();
    await vault.forgetSyncKey('book', binding);
    await vault.recoverPrevious(password);
    expect(await vault.hasSyncKey('book', binding)).toBe(false);
    const restored = new Vault(new WebBackend(crypto.randomUUID()));
    await restored.restore(backup, password, password);
    expect(restored.state!.entities.book).toBeDefined();
    await expect(restored.prepareSyncKey('book', binding)).rejects.toThrow('首次下载');
  });
  it('单个密钥密文被替换不会解开另一账本，也不阻止解锁本地数据', async () => {
    const { disk, vault } = await setup();
    await remember(vault);
    await remember(vault, replacement, 'second-book');
    const row = (await disk.read())!,
      archive = JSON.parse(row.payload);
    const ids = Object.keys(archive.deviceSyncKeys);
    archive.deviceSyncKeys[ids[0]] = archive.deviceSyncKeys[ids[1]];
    await disk.compareSwap(row.revision, JSON.stringify(archive));
    await vault.unlock(password);
    expect(vault.state!.entities.book).toBeDefined();
    await expect(vault.prepareSyncKey('book', binding)).rejects.toThrow('无法读取');
    await canDecrypt(vault, replacement, 'second-book');
    await remember(vault);
    await canDecrypt(vault);
  });
});

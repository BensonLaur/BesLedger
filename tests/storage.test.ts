import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { WebBackend } from '../src/storage/backend';
import { Vault, migrate } from '../src/storage/vault';
import { emptyState, put } from '../src/domain/model';
import { decrypt, encrypt, importKey } from '../src/crypto/vault';
describe('加密存储和失败恢复', () => {
  it('落盘过程中锁定不会被迟到的保存回调重新解锁', async () => {
    const disk = new WebBackend(crypto.randomUUID());
    let gated = false;
    let begin!: () => void, finish!: () => void;
    const started = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const released = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const vault = new Vault({
      read: () => disk.read(),
      compareSwap: async (revision, payload) => {
        if (gated) {
          begin();
          await released;
        }
        return disk.compareSwap(revision, payload);
      },
    });
    await vault.create('fictional-test-password');
    gated = true;
    const mutation = vault.mutate((s) => put(s, { kind: 'ledger', name: '虚构锁定测试' }));
    await started;
    vault.lock();
    finish();
    await expect(mutation).rejects.toThrow('锁定');
    expect(vault.state).toBeUndefined();
    await vault.unlock('fictional-test-password');
    expect(Object.values(vault.state!.entities)).toHaveLength(1);
  });
  it('重启恢复、密文不含明文；错误口令和篡改无法解密', async () => {
    const backend = new WebBackend(crypto.randomUUID()),
      a = new Vault(backend);
    await a.create('fictional-test-password');
    await a.mutate((s) => put(s, { kind: 'ledger', name: '虚构秘密测试账本' }));
    expect((await backend.read())!.payload).not.toContain('虚构秘密测试账本');
    const b = new Vault(backend);
    await expect(b.unlock('incorrect-password')).rejects.toThrow();
    await b.unlock('fictional-test-password');
    expect(Object.keys(b.state!.entities)).toHaveLength(1);
    const backup = JSON.parse(await b.exportBackup());
    backup.data.ciphertext = `A${backup.data.ciphertext.slice(1)}`;
    await expect(b.inspectBackup(JSON.stringify(backup), 'fictional-test-password')).rejects.toThrow();
    backend.close();
  });
  it('完整备份支持独立恢复密钥，恢复后设备身份不同；失败保持原数据库', async () => {
    const a = new Vault(new WebBackend(crypto.randomUUID()));
    const recovery = await a.create('fictional-test-password');
    await a.mutate((s) => put(s, { kind: 'ledger', name: '虚构可恢复账本' }));
    const text = await a.exportBackup();
    const backend = new WebBackend(crypto.randomUUID()),
      b = new Vault(backend);
    await b.restore(text, recovery, 'another-test-password', true);
    expect(b.state!.entities).toEqual(a.state!.entities);
    expect(b.state!.deviceId).not.toBe(a.state!.deviceId);
    const before = await backend.read();
    await expect(b.restore('{}', recovery, 'another-test-password', true)).rejects.toThrow();
    expect(await backend.read()).toEqual(before);
    b.lock();
    await b.unlock('another-test-password');
  });
  it('两个窗口并发保存明确拒绝旧版本，上一版本可以恢复', async () => {
    const backend = new WebBackend(crypto.randomUUID()),
      a = new Vault(backend),
      b = new Vault(backend);
    await a.create('fictional-test-password');
    await b.unlock('fictional-test-password');
    await a.mutate((s) => put(s, { kind: 'ledger', name: '甲窗口' }));
    await expect(b.mutate((s) => put(s, { kind: 'ledger', name: '乙窗口' }))).rejects.toThrow('另一个窗口');
    await a.recoverPrevious('fictional-test-password');
    expect(a.state!.entities).toEqual({});
  });
  it('升级保留身份和数据，未来未知版本不能清空重建', () => {
    const s = emptyState();
    expect(migrate({ ...s, schemaVersion: 1, bindings: undefined }).deviceId).toBe(s.deviceId);
    expect(() => migrate({ ...s, schemaVersion: 99 })).toThrow();
  });
  it('密文绑定用途，不能把一个账本的密文替换成另一账本', async () => {
    const key = await importKey(crypto.getRandomValues(new Uint8Array(32)));
    const a = await encrypt({ salary: 600000 }, key, 'ledger:a');
    const b = await encrypt({ salary: 600000 }, key, 'ledger:a');
    expect(a.iv).not.toBe(b.iv);
    await expect(decrypt(a, key, 'ledger:b')).rejects.toThrow();
  });
});

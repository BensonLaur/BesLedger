import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { WebBackend } from '../src/storage/backend';
import { Vault, migrate } from '../src/storage/vault';
import { emptyState, put } from '../src/domain/model';
import { decode, decrypt, encode, encrypt, importKey } from '../src/crypto/vault';
import { fixture, entry } from './fixtures';
import { saveEntry, deleteEntry, accountBalance } from '../src/domain/ledger';
import { list } from '../src/domain/model';
describe('加密存储和失败恢复', () => {
  it('备份恢复保留账户期初、退款关系、周期来源与删除标记', async () => {
    const a = new Vault(new WebBackend(crypto.randomUUID()));
    await a.create('fictional-backup-password');
    await a.mutate((s) => {
      const initial = fixture();
      s.entities = initial.entities;
      s.preferences = initial.preferences;
      const original = saveEntry(s, entry(s, { amount: 50000 }), 'backup-original');
      saveEntry(
        s,
        entry(s, { type: 'refund', amount: 10000, to: 'bank', originalId: original.id }),
        'backup-refund',
      );
      const period = saveEntry(
        s,
        entry(s, { source: { ruleId: 'rule-kept', occurrence: '2026-10-20' } }),
        'backup-period',
        false,
      );
      deleteEntry(s, period.id);
    });
    const b = new Vault(new WebBackend(crypto.randomUUID()));
    await b.restore(await a.exportBackup(), 'fictional-backup-password', 'fictional-new-password');
    expect(b.state!.entities).toEqual(a.state!.entities);
    expect(b.state!.entities['backup-period'].deleted).toBe(true);
    expect(b.state!.entities['backup-refund'].data).toMatchObject({ originalId: 'backup-original' });
    expect(
      accountBalance(
        b.state!,
        list(b.state!, 'account').find((x) => x.id === 'bank')!,
      ),
    ).toBe(210000);
  });
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
    // 翻转实际字节，避免随机密文原本以 A 开头时测试没有发生任何篡改。
    const tampered = decode(backup.data.ciphertext);
    tampered[0] ^= 1;
    backup.data.ciphertext = encode(tampered);
    await expect(
      // 失败断言也不输出 inspectBackup 返回的临时测试密钥。
      b.inspectBackup(JSON.stringify(backup), 'fictional-test-password').then(() => undefined),
    ).rejects.toThrow();
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

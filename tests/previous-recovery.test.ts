import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { Vault, LocalDataUnreadable } from '../src/storage/vault';
import { WebBackend, type StoredVault } from '../src/storage/backend';
import { put } from '../src/domain/model';
import { decode, encode, encrypt, importKey, parseRecovery } from '../src/crypto/vault';

const password = 'fictional-local-repair-password';
async function setup() {
  const name = crypto.randomUUID(),
    disk = new WebBackend(name),
    vault = new Vault(disk);
  const recovery = await vault.create(password);
  await vault.mutate((s) => put(s, { kind: 'ledger', name: '虚构备用账本' }, 'kept'));
  await vault.mutate((s) => put(s, { kind: 'ledger', name: '虚构最近改动' }, 'recent'));
  vault.lock();
  const db = new Dexie(name);
  db.version(1).stores({ vault: '&id' });
  async function alter(change: (row: StoredVault) => void) {
    const row = (await disk.read())!;
    change(row);
    await db.table('vault').put(row);
  }
  const damage = () =>
    alter((row) => {
      const archive = JSON.parse(row.payload),
        bytes = decode(archive.data.ciphertext);
      bytes[0] ^= 1;
      archive.data.ciphertext = encode(bytes);
      row.payload = JSON.stringify(archive);
    });
  return { disk, vault, db, recovery, alter, damage };
}

describe('只在当前异常且备用副本可用时恢复', () => {
  it('提交期间再次锁定后，不被备用副本恢复的迟到回调重新解锁', async () => {
    const { disk, damage } = await setup();
    await damage();
    let started!: () => void, release!: () => void;
    const writing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const vault = new Vault({
      read: () => disk.read(),
      compareSwap: async (revision, payload, options) => {
        const result = await disk.compareSwap(revision, payload, options);
        started();
        await pending;
        return result;
      },
    });
    const attempt = vault.recoverPrevious(password);
    const rejected = expect(attempt).rejects.toThrow('本地空间已改变');
    await writing;
    vault.lock();
    release();
    await rejected;
    expect(vault.state).toBeUndefined();
    const reopened = new Vault(disk);
    await reopened.unlock(password);
    expect(Object.keys(reopened.state!.entities)).toEqual(['kept']);
  });
  it('正确密码打不开当前数据时可只读预览，确认后恢复已校验副本', async () => {
    const { disk, vault, damage } = await setup();
    await damage();
    const before = await disk.read();
    await expect(vault.unlock(password)).rejects.toBeInstanceOf(LocalDataUnreadable);
    const preview = await vault.previewPrevious(password);
    expect(Object.keys(preview.state.entities)).toEqual(['kept']);
    expect(await disk.read()).toEqual(before);
    expect(vault.state).toBeUndefined();
    await vault.recoverPrevious(password, { expectedRevision: preview.revision });
    expect(Object.keys(vault.state!.entities)).toEqual(['kept']);
    vault.lock();
    await vault.unlock(password);
    expect(Object.keys(vault.state!.entities)).toEqual(['kept']);
  });
  it('正常账本、错误密码、损坏或缺少备用副本都不提供可恢复预览', async () => {
    const { disk, vault, damage, alter } = await setup();
    let before = await disk.read();
    await expect(vault.previewPrevious(password)).rejects.toThrow('正常读取');
    await expect(vault.previewPrevious('fictional-wrong')).rejects.toThrow();
    expect(await disk.read()).toEqual(before);
    await damage();
    before = await disk.read();
    await expect(vault.previewPrevious('fictional-wrong')).rejects.not.toBeInstanceOf(LocalDataUnreadable);
    expect(await disk.read()).toEqual(before);
    await alter((row) => {
      row.previous = 'damaged-fictional-backup';
    });
    before = await disk.read();
    await expect(vault.previewPrevious(password)).rejects.toThrow();
    expect(await disk.read()).toEqual(before);
    await alter((row) => {
      delete row.previous;
    });
    await expect(vault.recoverPrevious(password)).rejects.toThrow('没有可用');
  });
  it('未来的归档、密文或业务格式要求升级，不能误判为损坏并回退', async () => {
    const { disk, vault, recovery, alter } = await setup();
    const original = (await disk.read())!;
    for (const target of ['archive', 'envelope', 'state']) {
      await alter((row) => Object.assign(row, structuredClone(original)));
      const archive = JSON.parse(original.payload);
      if (target === 'archive') archive.version = 2;
      else if (target === 'envelope') archive.data.version = 2;
      else
        archive.data = await encrypt(
          { schemaVersion: 99 },
          await importKey(parseRecovery(recovery)),
          'local-state',
        );
      await alter((row) => {
        row.payload = JSON.stringify(archive);
      });
      const before = await disk.read();
      await expect(vault.previewPrevious(password)).rejects.toThrow('更新版本');
      await expect(vault.recoverPrevious(password)).rejects.toThrow('更新版本');
      expect(await disk.read()).toEqual(before);
    }
  });
  it('确认前本地版本改变或取消操作时拒绝回退', async () => {
    const { disk, vault, damage, alter } = await setup();
    await damage();
    const preview = await vault.previewPrevious(password);
    await alter((row) => {
      row.revision++;
    });
    const before = await disk.read();
    await expect(vault.recoverPrevious(password, { expectedRevision: preview.revision })).rejects.toThrow(
      '已改变',
    );
    const abort = new AbortController();
    abort.abort();
    await expect(vault.recoverPrevious(password, { signal: abort.signal })).rejects.toThrow('已取消');
    expect(await disk.read()).toEqual(before);
    expect(vault.state).toBeUndefined();
  });
});

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { Vault } from '../src/storage/vault';
import { WebBackend, type Backend } from '../src/storage/backend';
import { WebCredentialBackend } from '../src/storage/credentials';
import { GitHubSession, type Login } from '../src/providers/github/session';
import { decode, decrypt, encode, encrypt, importKey, parseRecovery } from '../src/crypto/vault';
import { put, type Binding } from '../src/domain/model';
import { saveEntry, deleteEntry } from '../src/domain/ledger';
import { entry, fixture, fixtureApp } from './fixtures';

const oldPassword = 'fictional-old-password';
const newPassword = 'fictional-new-password';
const foreignKey = '12'.repeat(32);
const binding: Binding = { owner: 'fictional-owner', repo: 'BesLedger-Data', userId: 42, remoteExists: true };
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup() {
  const disk = new WebBackend(crypto.randomUUID());
  const vault = new Vault(disk);
  const recovery = await vault.create(oldPassword);
  await vault.mutate((s) => {
    const initial = fixture();
    s.entities = initial.entities;
    s.preferences = initial.preferences;
    s.bindings[s.preferences.currentLedger] = binding;
    put(s, { kind: 'ledger', name: '虚构第二本账' }, 'another-book');
    const original = saveEntry(s, entry(s, { amount: 50000 }), 'kept-original');
    saveEntry(
      s,
      entry(s, { type: 'refund', amount: 10000, to: 'bank', originalId: original.id }),
      'kept-refund',
    );
    const removed = saveEntry(
      s,
      entry(s, { source: { ruleId: 'fixture-rule', occurrence: '2026-10-20' } }),
      'kept-deleted',
      false,
    );
    deleteEntry(s, removed.id);
  });
  const lease = await vault.prepareSyncKey(vault.state!.preferences.currentLedger, binding, foreignKey);
  await vault.rememberSyncKey(lease, () => undefined);
  const state = structuredClone(vault.state!);
  vault.lock();
  return { disk, vault, recovery, state };
}

describe('忘记密码后原地恢复本机空间', () => {
  it('只更换密码封装，保留所有账目、身份、同步密钥和加密登录，重启可继续使用', async () => {
    const { disk, vault, recovery, state } = await setup();
    const credentials = new WebCredentialBackend(crypto.randomUUID());
    let login: Login | undefined;
    const session = new GitHubSession(
      credentials,
      async () => {
        throw new Error('本例不需要续期');
      },
      (value) => {
        login = value;
      },
      async () => Response.json({ id: 42, login: 'fictional-user' }),
      Date.now,
      fixtureApp,
    );
    await vault.unlock(oldPassword);
    await session.resume(await vault.credentialKey());
    await session.accept({ app: fixtureApp, accessToken: 'ghu_fictionalAccess' });
    const savedCredential = await credentials.read();
    const stale = new Vault(disk);
    await stale.unlock(oldPassword);
    session.suspend();
    vault.lock();
    const before = JSON.parse((await disk.read())!.payload);
    const formatted = recovery
      .toUpperCase()
      .match(/.{1,8}/g)!
      .join(' - ');
    await vault.resetPasswordWithRecovery(formatted, newPassword);
    expect(vault.state).toEqual(state);
    expect(vault.recovery === recovery).toBe(true);
    const after = (await disk.read())!,
      archive = JSON.parse(after.payload);
    expect(archive.data).toEqual(before.data);
    expect(archive.deviceSyncKeys).toEqual(before.deviceSyncKeys);
    expect(JSON.stringify(archive.header) !== JSON.stringify(before.header)).toBe(true);
    expect(after.previous === after.payload).toBe(true);
    expect(await credentials.read()).toEqual(savedCredential);
    await session.resume(await vault.credentialKey());
    expect(login?.user.login).toBe('fictional-user');
    await expect(stale.mutate((s) => put(s, { kind: 'ledger', name: '不应覆盖' }))).rejects.toThrow(
      '另一个窗口',
    );
    const check = new Vault(disk);
    await expect(check.unlock(oldPassword)).rejects.toThrow();
    await expect(check.recoverPrevious(oldPassword)).rejects.toThrow();
    await check.unlock(newPassword);
    expect(check.state).toEqual(state);
    const message = await encrypt('虚构密钥验证', await importKey(parseRecovery(foreignKey)), 'probe');
    const lease = await check.prepareSyncKey(state.preferences.currentLedger, binding);
    expect(await decrypt(message, lease.key, 'probe')).toBe('虚构密钥验证');
    check.lock();
    await check.unlock(newPassword);
    expect(check.state).toEqual(state);
    session.dispose();
    credentials.close();
    disk.close();
  });

  it('错误密钥、格式不完整和短密码均不写盘、不解锁，随后可重试成功', async () => {
    const { disk, vault, recovery, state } = await setup();
    const before = await disk.read();
    for (const [key, password] of [
      ['00'.repeat(32), newPassword],
      ['incomplete', newPassword],
      [recovery, 'short'],
    ]) {
      await expect(vault.resetPasswordWithRecovery(key, password)).rejects.toThrow();
      expect(await disk.read()).toEqual(before);
      expect(vault.state).toBeUndefined();
    }
    await vault.resetPasswordWithRecovery(recovery, newPassword);
    expect(vault.state).toEqual(state);
    disk.close();
  });

  it('密文篡改与未知归档版本拒绝恢复，不改动原记录', async () => {
    for (const future of [false, true]) {
      const { disk, vault, recovery } = await setup();
      const row = (await disk.read())!,
        archive = JSON.parse(row.payload);
      if (future) archive.version = 99;
      else {
        const bytes = decode(archive.data.ciphertext);
        bytes[0] ^= 1;
        archive.data.ciphertext = encode(bytes);
      }
      await disk.compareSwap(row.revision, JSON.stringify(archive));
      const before = await disk.read();
      await expect(vault.resetPasswordWithRecovery(recovery, newPassword)).rejects.toThrow();
      expect(await disk.read()).toEqual(before);
      expect(vault.state).toBeUndefined();
      disk.close();
    }
  });

  it('另一个窗口修改后，CAS 拒绝重设覆盖最新账目', async () => {
    const { disk, recovery } = await setup();
    const entered = gate(),
      release = gate();
    const vault = new Vault({
      read: () => disk.read(),
      compareSwap: async (revision, payload, options) => {
        entered.resolve();
        await release.promise;
        return disk.compareSwap(revision, payload, options);
      },
    });
    const other = new Vault(disk);
    await other.unlock(oldPassword);
    const result = expect(vault.resetPasswordWithRecovery(recovery, newPassword)).rejects.toThrow(
      '另一个窗口',
    );
    await entered.promise;
    await other.mutate((s) => put(s, { kind: 'ledger', name: '虚构并发新账' }, 'latest-book'));
    const latest = await disk.read();
    release.resolve();
    await result;
    expect(await disk.read()).toEqual(latest);
    expect(vault.state).toBeUndefined();
    await vault.unlock(oldPassword);
    expect(vault.state!.entities['latest-book']).toBeDefined();
    disk.close();
  });

  it('取消验证或存储失败时保持锁定与原数据', async () => {
    const { disk, recovery } = await setup();
    const entered = gate(),
      release = gate();
    let writes = 0;
    const backend: Backend = {
      read: async () => {
        entered.resolve();
        await release.promise;
        return disk.read();
      },
      compareSwap: async () => {
        writes++;
        throw new Error('虚构存储失败');
      },
    };
    const vault = new Vault(backend),
      controller = new AbortController();
    const before = await disk.read();
    const cancelled = expect(
      vault.resetPasswordWithRecovery(recovery, newPassword, controller.signal),
    ).rejects.toThrow('取消');
    await entered.promise;
    controller.abort();
    release.resolve();
    await cancelled;
    expect(writes).toBe(0);
    await expect(vault.resetPasswordWithRecovery(recovery, newPassword)).rejects.toThrow('存储失败');
    expect(await disk.read()).toEqual(before);
    expect(vault.state).toBeUndefined();
    disk.close();
  });

  it('提交期间再次锁定时不被迟到结果解锁，完整提交后仍可用新密码进入', async () => {
    const { disk, recovery, state } = await setup();
    const entered = gate(),
      release = gate();
    const vault = new Vault({
      read: () => disk.read(),
      compareSwap: async (...args) => {
        const revision = await disk.compareSwap(...args);
        entered.resolve();
        await release.promise;
        return revision;
      },
    });
    const result = expect(vault.resetPasswordWithRecovery(recovery, newPassword)).rejects.toThrow('已改变');
    await entered.promise;
    vault.lock();
    release.resolve();
    await result;
    expect(vault.state).toBeUndefined();
    await vault.unlock(newPassword);
    expect(vault.state).toEqual(state);
    disk.close();
  });

  it('未建空间和已解锁空间拒绝重设，不误建空账；重复请求只有首个生效', async () => {
    const empty = new WebBackend(crypto.randomUUID());
    await expect(new Vault(empty).resetPasswordWithRecovery('00'.repeat(32), newPassword)).rejects.toThrow(
      '尚未创建',
    );
    expect(await empty.read()).toBeUndefined();
    empty.close();
    const { disk, vault, recovery } = await setup();
    await vault.unlock(oldPassword);
    const before = await disk.read();
    await expect(vault.resetPasswordWithRecovery(recovery, newPassword)).rejects.toThrow('先锁定');
    expect(await disk.read()).toEqual(before);
    vault.lock();
    const first = vault.resetPasswordWithRecovery(recovery, newPassword);
    const duplicate = expect(
      vault.resetPasswordWithRecovery(recovery, 'fictional-third-password'),
    ).rejects.toThrow('已改变');
    await first;
    await duplicate;
    vault.lock();
    await vault.unlock(newPassword);
    disk.close();
  });
});

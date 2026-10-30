import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { Vault } from '../src/storage/vault';
import { WebBackend, type Backend } from '../src/storage/backend';
import { decrypt, encrypt } from '../src/crypto/vault';
import { put, type Binding } from '../src/domain/model';
import { saveEntry } from '../src/domain/ledger';
import { entry, fixture } from './fixtures';

const oldPassword = 'fictional-change-old-password',
  newPassword = 'fictional-change-new-password';
const binding: Binding = { userId: 42, owner: 'fictional-owner', repo: 'BesLedger-Data', remoteExists: true };
async function setup() {
  const disk = new WebBackend(crypto.randomUUID()),
    vault = new Vault(disk);
  const recovery = await vault.create(oldPassword);
  await vault.mutate((s) => {
    const initial = fixture();
    s.entities = initial.entities;
    s.preferences = initial.preferences;
    s.bindings[s.preferences.currentLedger] = binding;
    put(s, { kind: 'ledger', name: '虚构第二本账' }, 'second-book');
    saveEntry(s, entry(s, { note: '虚构修改密码保留流水' }));
  });
  const lease = await vault.prepareSyncKey(vault.state!.preferences.currentLedger, binding, '12'.repeat(32));
  await vault.rememberSyncKey(lease, () => undefined);
  return { disk, vault, recovery };
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('修改密码只更换封装，全部账目、身份、绑定、登录派生密钥及已保存同步密钥保持不变', async () => {
  const { disk, vault, recovery } = await setup();
  const state = structuredClone(vault.state!),
    before = JSON.parse((await disk.read())!.payload);
  const credentials = await encrypt('fictional-credential', await vault.credentialKey(), 'credential-probe');
  const oldSync = await vault.prepareSyncKey(state.preferences.currentLedger, binding);
  const probe = await encrypt('fictional-sync-probe', oldSync.key, 'sync-probe');
  await vault.changePassword(oldPassword, newPassword);
  expect(vault.state).toEqual(state);
  expect(vault.recovery === recovery).toBe(true);
  const row = (await disk.read())!,
    after = JSON.parse(row.payload);
  expect(after.data).toEqual(before.data);
  expect(after.deviceSyncKeys).toEqual(before.deviceSyncKeys);
  expect(JSON.stringify(after.header) !== JSON.stringify(before.header)).toBe(true);
  expect(row.previous === row.payload).toBe(true);
  expect(await decrypt(credentials, await vault.credentialKey(), 'credential-probe')).toBe(
    'fictional-credential',
  );
  // 后续保存必须继续使用新封装，不能让一次记账重新启用旧密码。
  await vault.mutate((s) => put(s, { kind: 'ledger', name: '虚构改密后新增账' }, 'after-change'));
  vault.lock();
  await expect(vault.unlock(oldPassword)).rejects.toThrow();
  await expect(vault.recoverPrevious(oldPassword)).rejects.toThrow();
  await vault.unlock(newPassword);
  expect(vault.state!.entities['after-change']).toBeDefined();
  expect(vault.state!.bindings).toEqual(state.bindings);
  const savedSync = await vault.prepareSyncKey(state.preferences.currentLedger, binding);
  expect(savedSync.source).toBe('saved');
  expect(await decrypt(probe, savedSync.key, 'sync-probe')).toBe('fictional-sync-probe');
  expect(await decrypt(credentials, await vault.credentialKey(), 'credential-probe')).toBe(
    'fictional-credential',
  );
  disk.close();
});

it('错误原密码、短密码、已取消请求都不写盘，仍可用原密码并继续修改', async () => {
  const { disk, vault } = await setup();
  const before = await disk.read(),
    state = structuredClone(vault.state);
  await expect(vault.changePassword('fictional-wrong-password', newPassword)).rejects.toThrow(
    '原解锁密码不正确',
  );
  await expect(vault.changePassword(oldPassword, 'short')).rejects.toThrow('至少 10');
  await expect(vault.changePassword(oldPassword, newPassword, AbortSignal.abort())).rejects.toThrow('取消');
  expect(await disk.read()).toEqual(before);
  expect(vault.state).toEqual(state);
  vault.lock();
  await expect(vault.changePassword(oldPassword, newPassword)).rejects.toThrow('锁定');
  await vault.unlock(oldPassword);
  await vault.changePassword(oldPassword, newPassword);
  disk.close();
});

it('另一窗口修改后拒绝用旧会话改密，不覆盖新账目', async () => {
  const { disk, vault } = await setup(),
    other = new Vault(disk);
  await other.unlock(oldPassword);
  await other.mutate((s) => put(s, { kind: 'ledger', name: '虚构并发账本' }, 'other-book'));
  const latest = await disk.read();
  await expect(vault.changePassword(oldPassword, newPassword)).rejects.toThrow('其他窗口');
  expect(await disk.read()).toEqual(latest);
  vault.lock();
  await vault.unlock(oldPassword);
  expect(vault.state!.entities['other-book']).toBeDefined();
  disk.close();
});

it('验证期间取消或锁定不写盘，存储失败保持原密码可用', async () => {
  const { disk } = await setup(),
    entered = gate(),
    release = gate();
  let delay = false,
    writes = 0;
  const backend: Backend = {
    read: async () => {
      if (delay) {
        entered.resolve();
        await release.promise;
      }
      return disk.read();
    },
    compareSwap: async () => {
      writes++;
      throw new Error('虚构存储失败');
    },
  };
  const vault = new Vault(backend);
  await vault.unlock(oldPassword);
  const before = await disk.read();
  delay = true;
  const pending = expect(vault.changePassword(oldPassword, newPassword)).rejects.toThrow('锁定');
  await entered.promise;
  vault.lock();
  release.resolve();
  await pending;
  expect(writes).toBe(0);
  await vault.unlock(oldPassword);
  await expect(vault.changePassword(oldPassword, newPassword)).rejects.toThrow('存储失败');
  expect(await disk.read()).toEqual(before);
  expect(vault.state).toBeDefined();
  disk.close();
});

it('CAS 提交前发生并发写入会拒绝覆盖', async () => {
  const { disk } = await setup(),
    entered = gate(),
    release = gate();
  const vault = new Vault({
    read: () => disk.read(),
    compareSwap: async (...args) => {
      entered.resolve();
      await release.promise;
      return disk.compareSwap(...args);
    },
  });
  await vault.unlock(oldPassword);
  const result = expect(vault.changePassword(oldPassword, newPassword)).rejects.toThrow('另一个窗口');
  await entered.promise;
  const other = new Vault(disk);
  await other.unlock(oldPassword);
  await other.mutate((s) => put(s, { kind: 'ledger', name: '虚构最后提交' }, 'last-book'));
  const latest = await disk.read();
  release.resolve();
  await result;
  expect(await disk.read()).toEqual(latest);
  disk.close();
});

it('提交后锁定不会被迟到回调解锁，重新打开使用新密码', async () => {
  const { disk } = await setup(),
    entered = gate(),
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
  await vault.unlock(oldPassword);
  const state = structuredClone(vault.state);
  const result = expect(vault.changePassword(oldPassword, newPassword)).rejects.toThrow('锁定');
  await entered.promise;
  vault.lock();
  release.resolve();
  await result;
  expect(vault.state).toBeUndefined();
  await expect(vault.unlock(oldPassword)).rejects.toThrow();
  await vault.unlock(newPassword);
  expect(vault.state).toEqual(state);
  disk.close();
});

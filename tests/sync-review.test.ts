import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { fixture, entry } from './fixtures';
import { saveEntry } from '../src/domain/ledger';
import { put, stateSchema, type State } from '../src/domain/model';
import { digest } from '../src/crypto/vault';
import { ledgerProjection, mergeEntities } from '../src/sync/merge';
import { applySyncReview } from '../src/sync/review';
import { Vault } from '../src/storage/vault';
import { WebBackend } from '../src/storage/backend';

function differing() {
  const local = fixture();
  saveEntry(local, entry(local), 'fictional-entry');
  const remote = structuredClone(local);
  remote.deviceId = 'device-b';
  saveEntry(local, entry(local, { amount: 2000 }), 'fictional-entry');
  saveEntry(remote, entry(remote, { amount: 3000 }), 'fictional-entry');
  return { local, remote, id: local.preferences.currentLedger };
}
async function staged() {
  const { local, remote, id } = differing();
  local.syncReviews = {
    [id]: {
      remote: ledgerProjection(remote, id),
      conflicts: mergeEntities(local.entities, ledgerProjection(remote, id)).conflicts,
      choices: {},
      baseDigest: await digest(local.entities),
    },
  };
  return { local, remote, id };
}
it('旧账本保持兼容，检查时间与成功同步时间分别保存', () => {
  const state = fixture();
  expect(stateSchema.parse(state).syncReviews).toBeUndefined();
  state.bindings.book = {
    owner: 'fictional-user',
    repo: 'BesLedger-Data',
    userId: 42,
    remoteExists: true,
    lastChecked: '2026-10-30T10:00:00Z',
    lastSynced: '2026-10-29T10:00:00Z',
  };
  expect(stateSchema.parse(state).bindings.book.lastSynced).toBe('2026-10-29T10:00:00Z');
});
it('差异及选择加密保存，锁定重开与备份均保留，余额和云端投影不采用待选内容', async () => {
  const { local, id } = await staged();
  const disk = new WebBackend(crypto.randomUUID()),
    vault = new Vault(disk);
  const password = 'fictional-review-password';
  await vault.create(password);
  await vault.mutate((s) => Object.assign(s, local));
  await vault.mutate((s) => {
    s.syncReviews![id].choices['fictional-entry'] = 'remote';
  });
  const before = structuredClone(vault.state!.entities);
  expect(JSON.stringify((await disk.read())!.payload)).not.toContain('fictional-entry');
  expect(JSON.stringify(ledgerProjection(vault.state!, id))).not.toContain('baseDigest');
  vault.lock();
  await vault.unlock(password);
  expect(vault.state!.entities).toEqual(before);
  expect(vault.state!.syncReviews![id].choices['fictional-entry']).toBe('remote');
  const backup = await vault.exportBackup();
  const verified = await vault.inspectBackup(backup, password);
  expect(verified.state.syncReviews![id].choices['fictional-entry']).toBe('remote');
  verified.raw.fill(0);
  disk.close();
});
it('全部选择后一次性采用，形成待同步版本，未关联的本地账本保持不变', async () => {
  const { local, remote, id } = await staged();
  put(local, { kind: 'ledger', name: '虚构独立本地账' }, 'other-book');
  local.syncReviews![id].baseDigest = await digest(local.entities);
  local.syncReviews![id].choices['fictional-entry'] = 'remote';
  applySyncReview(local, id, await digest(local.entities));
  expect(local.entities['fictional-entry'].data).toEqual(remote.entities['fictional-entry'].data);
  expect(local.entities['other-book'].data).toEqual({ kind: 'ledger', name: '虚构独立本地账' });
  expect(local.syncReviews![id]).toBeUndefined();
  expect(mergeEntities(local.entities, ledgerProjection(remote, id)).conflicts).toEqual([]);
});
it('未选择完整及本地已有新变化时拒绝采用，不覆盖新账目', async () => {
  const { local, id } = await staged();
  expect(() => applySyncReview(structuredClone(local), id, local.syncReviews![id].baseDigest)).toThrow(
    '每一项',
  );
  local.syncReviews![id].choices['fictional-entry'] = 'remote';
  put(local, { kind: 'ledger', name: '虚构新增账' }, 'new-book');
  const before = structuredClone(local);
  expect(() => applySyncReview(local, id, 'different-current-digest')).toThrow('已有变化');
  expect(local).toEqual(before);
});
it('下载账本的共用账户存在差异时，完整采用账本与关联实体后再校验', async () => {
  const local = fixture(),
    remote = structuredClone(local);
  remote.deviceId = 'device-b';
  const id = crypto.randomUUID();
  put(remote, { kind: 'ledger', name: '虚构另一台设备账本' }, id);
  saveEntry(remote, entry(remote, { ledgerId: id }), 'remote-entry');
  const localAccount = local.entities.cash.data,
    remoteAccount = remote.entities.cash.data;
  if (localAccount.kind !== 'account' || remoteAccount.kind !== 'account') throw new Error('fixture');
  put(local, { ...localAccount, name: '虚构本地现金' }, 'cash');
  put(remote, { ...remoteAccount, name: '虚构云端现金' }, 'cash');
  const projection = ledgerProjection(remote, id),
    merged = mergeEntities(local.entities, projection);
  local.syncReviews = {
    [id]: {
      remote: projection,
      conflicts: merged.conflicts,
      choices: { cash: 'local' },
      baseDigest: await digest(local.entities),
    },
  };
  applySyncReview(local, id, local.syncReviews[id].baseDigest);
  expect(local.entities[id].data).toEqual({ kind: 'ledger', name: '虚构另一台设备账本' });
  expect(local.entities['remote-entry']).toBeDefined();
  expect(local.entities.cash.data).toMatchObject({ name: '虚构本地现金' });
  expect(local.preferences.currentLedger).toBe(id);
});
it('差异远端内容超出目标账本范围时拒绝导入', async () => {
  const { local, id } = await staged();
  local.syncReviews![id].choices['fictional-entry'] = 'local';
  const extra = fixture();
  put(extra, { kind: 'ledger', name: '虚构越界账本' }, 'bad-book');
  local.syncReviews![id].remote['bad-book'] = extra.entities['bad-book'];
  expect(() => applySyncReview(local, id, local.syncReviews![id].baseDigest)).toThrow('其他账本');
});

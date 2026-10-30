import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { fixture, entry } from './fixtures';
import { changeAccountOpeningTime, accountBalance, saveEntry } from '../src/domain/ledger';
import { list, put } from '../src/domain/model';
import { Vault } from '../src/storage/vault';
import { WebBackend } from '../src/storage/backend';

it('调整起算时间保留起始金额及账户信息，已有流水按新边界重算，其他账户保持独立', () => {
  const state = fixture();
  const original = list(state, 'account').find((a) => a.id === 'cash')!;
  const account = put(state, { ...original.data, openedAt: '2026-10-15T10:30:00' }, original.id);
  saveEntry(state, entry(state, { amount: 1234, at: '2026-09-01T00:00:00' }), 'at-boundary');
  saveEntry(
    state,
    entry(state, { type: 'transfer', amount: 2000, to: 'bank', at: '2026-09-01T08:09:00' }),
    'transfer',
  );
  saveEntry(state, entry(state, { amount: 500, at: '2026-08-31T23:59:59' }), 'before-day');
  const entries = structuredClone(list(state, 'entry'));
  expect(
    accountBalance(
      state,
      list(state, 'account').find((a) => a.id === 'cash')!,
    ),
  ).toBe(100000);
  const changed = changeAccountOpeningTime(state, 'cash', '2026-09-01T00:00:00', account.clock);
  expect(changed.data).toEqual({ ...account.data, openedAt: '2026-09-01T00:00:00' });
  expect(accountBalance(state, changed)).toBe(96766);
  expect(
    accountBalance(
      state,
      list(state, 'account').find((a) => a.id === 'bank')!,
    ),
  ).toBe(202000);
  expect(list(state, 'entry')).toEqual(entries);
});

it('非法日期、已删除账户及过期账户版本拒绝调整，不覆盖已有账户或账目', () => {
  const state = fixture(),
    original = structuredClone(state.entities.cash);
  for (const time of ['invalid', '2026-02-30T00:00:00']) {
    expect(() => changeAccountOpeningTime(state, 'cash', time, original.clock)).toThrow();
    expect(state.entities.cash).toEqual(original);
  }
  const account = list(state, 'account').find((a) => a.id === 'cash')!;
  put(state, { ...account.data, name: '虚构另一个窗口改名' }, 'cash');
  const changed = structuredClone(state.entities.cash);
  expect(() => changeAccountOpeningTime(state, 'cash', '2026-09-01T00:00:00', original.clock)).toThrow(
    '已有变化',
  );
  expect(state.entities.cash).toEqual(changed);
  put(state, account.data, 'cash', true);
  expect(() =>
    changeAccountOpeningTime(state, 'cash', '2026-09-01T00:00:00', state.entities.cash.clock),
  ).toThrow('不可用');
});

it('保存后锁定重开保留新起算时间，另一窗口的保存由 CAS 保护', async () => {
  const disk = new WebBackend(crypto.randomUUID()),
    vault = new Vault(disk);
  const password = 'fictional-account-opening-password';
  await vault.create(password);
  await vault.mutate((s) => Object.assign(s, fixture()));
  const stale = new Vault(disk);
  await stale.unlock(password);
  await vault.mutate((s) =>
    changeAccountOpeningTime(s, 'cash', '2026-09-01T00:00:00', s.entities.cash.clock),
  );
  const stored = await disk.read();
  await expect(
    stale.mutate((s) => changeAccountOpeningTime(s, 'cash', '2026-09-02T00:00:00', s.entities.cash.clock)),
  ).rejects.toThrow('另一个窗口');
  expect(await disk.read()).toEqual(stored);
  vault.lock();
  await vault.unlock(password);
  expect(list(vault.state!, 'account').find((a) => a.id === 'cash')!.data.openedAt).toBe(
    '2026-09-01T00:00:00',
  );
  disk.close();
});

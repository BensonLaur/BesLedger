import { Vault } from '../../src/storage/vault';
import { put } from '../../src/domain/model';
import { builtins } from '../../src/domain/categories';
import type { Account } from '../../src/domain/model';
import type { StoredVault } from '../../src/storage/backend';

/** 选择器演示独立构造；跨账本流水用于验证余额沿用共用账户口径。 */
export async function accountPickerFixture(mode: 'single' | 'many' | 'empty' | 'ambiguous') {
  let row: StoredVault | undefined;
  const vault = new Vault({
    read: async () => row,
    compareSwap: async (expected, payload) => {
      row = { id: 'vault', revision: expected + 1, payload };
      return row.revision;
    },
  });
  await vault.create('fictional-picker-password');
  await vault.mutate((state) => {
    put(state, { kind: 'ledger', name: '虚构账户选择体验' }, 'picker-ledger');
    state.preferences.currentLedger = 'picker-ledger';
    if (mode === 'empty') return;
    const account: Account = {
      kind: 'account',
      name: '日常储蓄卡',
      type: 'bank',
      displayType: 'bank',
      opening: 100000,
      openedAt: '2026-01-01T00:00:00',
      bank: '示例银行',
      tail: '1234',
    };
    put(state, account, 'picker-bank');
    if (mode === 'ambiguous') {
      put(state, { ...account, name: '同尾号备用卡' }, 'picker-duplicate-bank');
      return;
    }
    if (mode === 'single') return;
    for (const [id, name, type, opening, displayType] of [
      ['cash', '随身现金', 'cash', 50000, 'cash'],
      ['wallet', '旅行与家用的微信零钱长名称账户', 'wallet', 68000, 'wallet'],
      ['credit', '日常信用卡', 'credit', -42000, 'credit'],
      ['credit-extra', '有余款的信用卡', 'credit', 12000, 'credit'],
      ['investment', '基金账户', 'asset', 850000, 'investment'],
      ['stored', '食堂饭卡', 'wallet', 26000, 'stored'],
      ['person', '朋友甲', 'receivable', -40000, 'receivable'],
    ] as const)
      put(state, { ...account, name, type, opening, displayType, bank: '', tail: '' }, id);
    put(state, { kind: 'ledger', name: '另一虚构账本' }, 'picker-other-ledger');
    put(state, {
      kind: 'entry',
      ledgerId: 'picker-other-ledger',
      type: 'expense',
      amount: 1234,
      interest: 0,
      from: 'picker-bank',
      to: '',
      categoryId: builtins.find((c) => c.name === '停车费')!.id,
      at: '2026-11-20T12:00:00',
      createdAt: '2026-11-20T12:00:00',
      note: '跨账本虚构记录',
      behavior: '',
    });
  });
  vault.lock();
  return row!;
}

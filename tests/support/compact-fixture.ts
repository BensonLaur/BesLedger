import { Vault } from '../../src/storage/vault';
import { put } from '../../src/domain/model';
import { builtins } from '../../src/domain/categories';
import type { StoredVault } from '../../src/storage/backend';

/** 独立测试上下文的虚构数据，不读取用户现有浏览器或模拟器的账目。 */
export async function compactFixture(negative = false) {
  let row: StoredVault | undefined;
  const vault = new Vault({
    read: async () => row,
    compareSwap: async (expected, payload) => {
      if ((row?.revision ?? 0) !== expected) throw Error('CAS');
      row = { id: 'vault', revision: expected + 1, payload };
      return row.revision;
    },
  });
  await vault.create('fictional-compact-password');
  await vault.mutate((s) => {
    const ledgerId = 'compact-ledger';
    put(s, { kind: 'ledger', name: '日常生活 · 虚构展示' }, ledgerId);
    s.preferences.currentLedger = ledgerId;
    for (const [id, name, type, opening, displayType] of [
      ['cash', '随身现金', 'cash', 50000, 'cash'],
      ['bank', '日常银行卡', 'bank', 280000, 'bank'],
      ['wallet', '旅行和日常共用的微信零钱账户', 'wallet', 68000, 'wallet'],
      ['credit', '日常信用卡', 'credit', -42000, 'credit'],
      ['credit-extra', '有余款的信用卡', 'credit', 12000, 'credit'],
      ['investment', '基金账户', 'asset', 850000, 'investment'],
      ['stored', '食堂饭卡', 'wallet', 26000, 'stored'],
      ['person', '朋友甲', 'receivable', -40000, 'receivable'],
    ] as const)
      put(
        s,
        {
          kind: 'account',
          name,
          type,
          opening,
          displayType,
          openedAt: '2026-01-01T00:00:00',
          bank: '',
          tail: '',
        },
        id,
      );
    function entry(
      day: number,
      amount: number,
      name: string,
      type: 'expense' | 'income' = 'expense',
      account = 'bank',
    ) {
      const at = `2026-11-${String(day).padStart(2, '0')}T12:15:00`;
      return put(s, {
        kind: 'entry',
        ledgerId,
        type,
        amount,
        interest: 0,
        from: type === 'income' ? '' : account,
        to: type === 'income' ? account : '',
        categoryId: builtins.find((c) => c.name === name)!.id,
        at,
        note: `${name} · 虚构记录`,
        behavior: '',
        createdAt: at,
      });
    }
    entry(1, 600000, '工资薪水', 'income');
    for (let day = 1; day <= 20; day++) {
      entry(day, 2200 + day * 50, '午餐');
      entry(day, 600 + day * 10, '早餐', 'expense', 'cash');
    }
    entry(4, 12800, '买菜原料', 'expense', 'wallet');
    entry(5, 3200, '打车', 'expense', 'credit');
    entry(6, 3500, '水电燃气');
    entry(8, 16800, '家居百货');
    entry(10, 1500, '停车费');
    entry(12, 800, '手机电话');
    entry(15, 2000, '饮料水果');
    if (negative) {
      const id = entry(1, 50000, '加油');
      const original = id;
      if (original.data.kind !== 'entry') throw Error('Fixture');
      original.data.at = '2026-10-30T12:00:00';
      put(s, {
        ...original.data,
        type: 'refund',
        from: '',
        to: 'bank',
        amount: 50000,
        at: '2026-11-22T12:00:00',
        originalId: original.id,
        note: '上月消费退款 · 虚构',
      });
    }
    put(s, { kind: 'budget', ledgerId, month: '2026-11', amount: 250000, enabled: true });
  });
  vault.lock();
  return row!;
}

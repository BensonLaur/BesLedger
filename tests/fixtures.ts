import { emptyState, put, type Entry, type State } from '../src/domain/model';
export function fixture(): State {
  const state = emptyState();
  state.deviceId = 'device-a';
  put(state, { kind: 'ledger', name: '虚构测试账本' }, '11111111-1111-4111-8111-111111111111');
  state.preferences.currentLedger = '11111111-1111-4111-8111-111111111111';
  for (const [id, name, type, opening] of [
    ['cash', '虚构现金', 'cash', 100000],
    ['bank', '虚构银行卡', 'bank', 200000],
    ['person', '虚构往来', 'receivable', 0],
  ] as const) {
    put(
      state,
      {
        kind: 'account',
        name,
        type,
        opening,
        openedAt: '2026-01-01T00:00:00',
        bank: type === 'bank' ? '工商银行' : '',
        tail: type === 'bank' ? '1234' : '',
      },
      id,
    );
  }
  return state;
}
export function entry(state: State, overrides: Partial<Entry> = {}): Entry {
  return {
    kind: 'entry',
    ledgerId: state.preferences.currentLedger,
    type: 'expense',
    amount: 1000,
    interest: 0,
    from: 'cash',
    to: '',
    categoryId: 'expense.food.001',
    at: '2026-10-20T12:00:00',
    note: '完全虚构测试',
    behavior: '转账',
    createdAt: '2026-10-21T12:00:00',
    ...overrides,
  };
}

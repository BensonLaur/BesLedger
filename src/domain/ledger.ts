import {
  entrySchema,
  list,
  put,
  tombstone,
  type Account,
  type Entity,
  type Entry,
  type State,
} from './model';
import { sum } from './money';
import { localTime } from './time';

export type Movement = { accountId: string; amount: number };
export function movements(e: Entry): Movement[] {
  switch (e.type) {
    case 'expense':
      return [{ accountId: e.from, amount: -e.amount }];
    case 'income':
    case 'refund':
      return [{ accountId: e.to, amount: e.amount }];
    case 'repay':
      return [
        { accountId: e.from, amount: -e.amount },
        { accountId: e.to, amount: e.amount - e.interest },
      ];
    case 'collect':
      return [
        { accountId: e.from, amount: -(e.amount - e.interest) },
        { accountId: e.to, amount: e.amount },
      ];
    default:
      return [
        { accountId: e.from, amount: -e.amount },
        { accountId: e.to, amount: e.amount },
      ];
  }
}
export function contribution(e: Entry): { income: number; expense: number } {
  return {
    income: e.type === 'income' ? e.amount : e.type === 'collect' ? e.interest : 0,
    expense:
      e.type === 'expense' ? e.amount : e.type === 'refund' ? -e.amount : e.type === 'repay' ? e.interest : 0,
  };
}
export function totals(entries: Entry[]): { income: number; expense: number; net: number } {
  const values = entries.map(contribution);
  const income = sum(values.map((v) => v.income)),
    expense = sum(values.map((v) => v.expense));
  return { income, expense, net: sum([income, -expense]) };
}
export function accountBalance(state: State, account: Entity<Account>): number {
  const amounts = list(state, 'entry')
    .filter((e) => e.data.at >= account.data.openedAt)
    .flatMap((e) => movements(e.data))
    .filter((m) => m.accountId === account.id)
    .map((m) => m.amount);
  // 起算时点之前的记录保留作查询，但不能重复叠加已包含在期初的资金。
  return sum([account.data.opening, ...amounts]);
}
export function validateEntry(state: State, input: Entry, entityId?: string): Entry {
  const e = entrySchema.parse(input);
  const ledger = state.entities[e.ledgerId];
  if (!ledger || ledger.deleted || ledger.data.kind !== 'ledger') throw new Error('请选择可用账本');
  if (e.interest > e.amount) throw new Error('包含利息不能大于总额');
  if (!['repay', 'collect'].includes(e.type) && e.interest !== 0) throw new Error('本操作不支持利息');
  for (const m of movements(e)) {
    const account = state.entities[m.accountId];
    if (!account || account.deleted || account.data.kind !== 'account') throw new Error('请选择有效资金账户');
  }
  if (movements(e).length === 2 && e.from === e.to) throw new Error('两端不能选择同一账户');
  if (['borrow', 'lend', 'repay', 'collect'].includes(e.type)) {
    const counterpart = ['borrow', 'collect'].includes(e.type) ? e.from : e.to;
    const fund = counterpart === e.from ? e.to : e.from;
    const c = state.entities[counterpart].data,
      f = state.entities[fund].data;
    if (c.kind !== 'account' || c.type !== 'receivable') throw new Error('往来方必须是应收应付账户');
    if (f.kind !== 'account' || f.type === 'receivable') throw new Error('资金端请选择实际资金账户');
  }
  if (e.type === 'refund') {
    const original = e.originalId && state.entities[e.originalId];
    if (
      !original ||
      original.deleted ||
      original.data.kind !== 'entry' ||
      original.data.type !== 'expense' ||
      original.data.ledgerId !== e.ledgerId
    )
      throw new Error('退款必须关联本账本有效支出');
    const refunded = sum(
      list(state, 'entry')
        .filter((x) => x.id !== entityId && x.data.type === 'refund' && x.data.originalId === e.originalId)
        .map((x) => x.data.amount),
    );
    if (sum([refunded, e.amount]) > original.data.amount)
      throw new Error('累计退款不能超过原支出；额外补贴请单独记录收入');
    e.categoryId = original.data.categoryId;
  }
  if (entityId) {
    const refunds = list(state, 'entry').filter(
      (x) => x.data.type === 'refund' && x.data.originalId === entityId,
    );
    if (refunds.length && (e.type !== 'expense' || sum(refunds.map((x) => x.data.amount)) > e.amount))
      throw new Error('原单金额不能低于累计退款，且不能改为其他类型');
  }
  return e;
}
export function saveEntry(state: State, input: Entry, entityId?: string, manual = true): Entity<Entry> {
  const e = validateEntry(state, input, entityId);
  const old = entityId ? state.entities[entityId]?.data : undefined;
  if (manual && ['expense', 'income'].includes(e.type)) {
    e.manualCategoryAt =
      old?.kind === 'entry' && old.categoryId === e.categoryId ? old.manualCategoryAt : localTime();
  }
  const saved = put(state, e, entityId) as Entity<Entry>;
  // 原单改分类时，同一事务内更新退款的归属，保持汇总与详情同源。
  if (e.type === 'expense')
    for (const refund of list(state, 'entry').filter((x) => x.data.originalId === saved.id)) {
      if (refund.data.categoryId !== e.categoryId)
        put(state, { ...refund.data, categoryId: e.categoryId }, refund.id);
    }
  return saved;
}
export function deleteEntry(state: State, entityId: string): void {
  if (list(state, 'entry').some((e) => e.data.originalId === entityId))
    throw new Error('请先删除关联退款，再删除原单');
  tombstone(state, entityId);
}
export function restoreEntity(state: State, entityId: string): void {
  const old = state.entities[entityId];
  if (!old?.deleted) throw new Error('记录未处于删除状态');
  put(state, old.data, entityId, false);
  // 恢复是新的显式修改，继承墓碑因果版本；旧设备不会把它当成旧快照。
  validateState(state);
}
export function validateState(state: State): void {
  for (const [key, value] of Object.entries(state.entities))
    if (key !== value.id) throw new Error('数据身份不一致');
  for (const entity of list(state, 'entry')) validateEntry(state, entity.data, entity.id);
  for (const entity of list(state, 'rule')) {
    if (entity.data.template.ledgerId !== entity.data.ledgerId) throw new Error('周期规则与模板账本不一致');
    validateEntry(state, entity.data.template);
    if (entity.data.end && entity.data.end < entity.data.start) throw new Error('周期结束早于开始日期');
  }
  for (const account of list(state, 'account')) accountBalance(state, account);
}

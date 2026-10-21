import { contribution, totals } from './ledger';
import { type Entity, type Entry } from './model';
import { dayAdd } from './time';
import { sum } from './money';
export type Filter = {
  ledgerId?: string;
  month?: string;
  day?: string;
  from?: string;
  through?: string;
  categoryId?: string;
  accountId?: string;
  keyword?: string;
};
export function filterEntries(entries: Entity<Entry>[], filter: Filter): Entity<Entry>[] {
  return entries
    .filter(
      ({ deleted, data: e }) =>
        !deleted &&
        (!filter.ledgerId || e.ledgerId === filter.ledgerId) &&
        (!filter.month || e.at.startsWith(filter.month)) &&
        (!filter.day || e.at.startsWith(filter.day)) &&
        (!filter.from || e.at.slice(0, 10) >= filter.from) &&
        (!filter.through || e.at.slice(0, 10) <= filter.through) &&
        (!filter.categoryId || e.categoryId === filter.categoryId) &&
        (!filter.accountId || e.from === filter.accountId || e.to === filter.accountId) &&
        (!filter.keyword || e.note.toLocaleLowerCase().includes(filter.keyword.toLocaleLowerCase())),
    )
    .sort((a, b) => b.data.at.localeCompare(a.data.at) || a.id.localeCompare(b.id));
}
export function dailyTotals(entries: Entry[]): Record<string, ReturnType<typeof totals>> {
  const groups: Record<string, Entry[]> = {};
  for (const e of entries) (groups[e.at.slice(0, 10)] ??= []).push(e);
  return Object.fromEntries(Object.entries(groups).map(([day, values]) => [day, totals(values)]));
}
export function calendarScale(
  entries: Entry[],
  month: string,
  metric: 'income' | 'expense',
  today: string,
): number {
  const days = dailyTotals(entries);
  let values = Object.entries(days)
    .filter(([day, v]) => day.startsWith(month) && day <= today && v[metric] !== 0)
    .map(([, v]) => Math.abs(v[metric]));
  if (values.length < 10)
    values = values.concat(
      Object.entries(days)
        .filter(([day, v]) => day >= dayAdd(`${month}-01`, -90) && day < `${month}-01` && v[metric] !== 0)
        .map(([, v]) => Math.abs(v[metric])),
    );
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  const reference = values.length >= 10 ? values[Math.ceil(values.length * 0.9) - 1] : values.at(-1)!;
  const factor = 10 ** Math.floor(Math.log10(reference));
  return Math.ceil([1, 2, 2.5, 5, 10].find((x) => x * factor >= reference)! * factor);
}
export function groupReport(
  entries: Entry[],
  dimension: 'category' | 'account' | 'month',
): { id: string; income: number; expense: number }[] {
  const groups = new Map<string, { income: number[]; expense: number[] }>();
  for (const entry of entries) {
    const value = contribution(entry);
    if (!value.income && !value.expense) continue;
    const id =
      dimension === 'month'
        ? entry.at.slice(0, 7)
        : dimension === 'category'
          ? entry.type === 'repay'
            ? 'expense.investment.001'
            : entry.type === 'collect'
              ? 'income.011'
              : entry.categoryId
          : value.income || entry.type === 'refund'
            ? entry.to
            : entry.from;
    const group = groups.get(id) ?? { income: [], expense: [] };
    group.income.push(value.income);
    group.expense.push(value.expense);
    groups.set(id, group);
  }
  return [...groups].map(([id, v]) => ({ id, income: sum(v.income), expense: sum(v.expense) }));
}

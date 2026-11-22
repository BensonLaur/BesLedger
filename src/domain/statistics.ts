import type { CategoryOption } from './categories';
import { contribution } from './ledger';
import { sum } from './money';
import type { Entity, Entry } from './model';
import { effectiveCategory } from './reports';
import { dayAdd, monthDate, validTime } from './time';

export type StatisticMetric = 'expense' | 'income' | 'net';
export type StatisticView = 'trend' | 'group' | 'category' | 'account';
export type StatisticPeriod = 'month' | 'year' | 'all' | 'custom';
export type StatisticRange = { from: string; through: string; grain: 'day' | 'month' | 'year'; days: number };
export type StatisticRow = {
  id: string;
  label: string;
  value: number;
  count: number;
  income: number;
  expense: number;
  net: number;
};

function validDay(day: string): boolean {
  return validTime(`${day}T12:00:00`);
}
function dateNumber(day: string): number {
  return Date.parse(`${day}T12:00:00+08:00`);
}
export function statisticRange(
  mode: StatisticPeriod,
  month: string,
  year: string,
  custom: { from: string; through: string },
  entries: Entity<Entry>[],
  today: string,
): StatisticRange {
  let from: string, through: string;
  if (mode === 'month') {
    from = `${month}-01`;
    through = monthDate(month, 31);
  } else if (mode === 'year') {
    from = `${year}-01-01`;
    through = `${year}-12-31`;
  } else if (mode === 'custom') {
    ({ from, through } = custom);
  } else {
    const dates = entries
      .filter((entry) => !entry.deleted)
      .map((entry) => entry.data.at.slice(0, 10))
      .sort();
    from = dates[0] || today;
    through = [dates.at(-1) || today, today].sort().at(-1)!;
  }
  if (!validDay(from) || !validDay(through) || from > through) throw new Error('请选择有效的起止日期');
  const days = Math.round((dateNumber(through) - dateNumber(from)) / 86400000) + 1;
  // 日均按所选区间的自然天数，图表仅反映已记账数据；不把无记录解释为没有消费。
  const months =
    (Number(through.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    Number(through.slice(5, 7)) -
    Number(from.slice(5, 7)) +
    1;
  const grain =
    mode === 'month' || (mode === 'custom' && days <= 62)
      ? 'day'
      : months <= 24 || mode === 'year'
        ? 'month'
        : 'year';
  return { from, through, grain, days };
}

export function statisticValue(entry: Entry, metric: StatisticMetric): number {
  const value = contribution(entry);
  return metric === 'net' ? sum([value.income, -value.expense]) : value[metric];
}

/** 所有分组和明细共用身份映射，包含退款入账账户与借还利息分类的既有约定。 */
export function statisticIdentity(
  entry: Entry,
  view: StatisticView,
  grain: StatisticRange['grain'],
  categories: CategoryOption[],
): string {
  if (view === 'trend') return entry.at.slice(0, grain === 'day' ? 10 : grain === 'month' ? 7 : 4);
  if (view === 'account')
    return contribution(entry).income || entry.type === 'refund' ? entry.to : entry.from;
  const id = effectiveCategory(entry);
  return view === 'category'
    ? id || '@uncategorized'
    : `group:${categories.find((category) => category.id === id)?.group || '待分类'}`;
}

export function statisticRows(
  entries: Entity<Entry>[],
  range: StatisticRange,
  view: StatisticView,
  metric: StatisticMetric,
  categories: CategoryOption[],
  accountNames: Record<string, string>,
): StatisticRow[] {
  const groups = new Map<string, Entry[]>();
  if (view === 'trend') {
    // 完整补齐时间轴，但 count=0 仍标为未记录；月/年长区间不逐日循环。
    if (range.grain === 'day') {
      for (let day = range.from; ; day = dayAdd(day, 1)) {
        groups.set(day, []);
        if (day === range.through) break;
      }
    } else if (range.grain === 'month') {
      for (let year = Number(range.from.slice(0, 4)); year <= Number(range.through.slice(0, 4)); year++)
        for (let month = 1; month <= 12; month++) {
          const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
          if (key >= range.from.slice(0, 7) && key <= range.through.slice(0, 7)) groups.set(key, []);
        }
    } else {
      for (let year = Number(range.from.slice(0, 4)); year <= Number(range.through.slice(0, 4)); year++)
        groups.set(String(year).padStart(4, '0'), []);
    }
  }
  for (const entity of entries) {
    const entry = entity.data;
    if (entity.deleted || entry.at.slice(0, 10) < range.from || entry.at.slice(0, 10) > range.through)
      continue;
    const value = contribution(entry);
    if (metric === 'net' ? !value.income && !value.expense : !value[metric]) continue;
    const id = statisticIdentity(entry, view, range.grain, categories);
    const group = groups.get(id) || [];
    group.push(entry);
    groups.set(id, group);
  }
  return [...groups]
    .map(([id, values]) => {
      const income = sum(values.map((entry) => contribution(entry).income));
      const expense = sum(values.map((entry) => contribution(entry).expense));
      const net = sum([income, -expense]);
      const label =
        view === 'trend'
          ? id
          : view === 'account'
            ? accountNames[id] || '未知账户'
            : view === 'group'
              ? id.slice(6)
              : categories.find((category) => category.id === id)?.name || '待分类';
      return {
        id,
        label,
        value: metric === 'net' ? net : metric === 'income' ? income : expense,
        count: values.length,
        income,
        expense,
        net,
      };
    })
    .sort((a, b) =>
      view === 'trend' ? a.id.localeCompare(b.id) : b.value - a.value || a.id.localeCompare(b.id),
    );
}

/** 占比仅适用于非负分布。以整数分计算万分比并分配尾差，不能取负值绝对值伪造占比。 */
export function statisticShares(rows: Pick<StatisticRow, 'value'>[]): number[] | undefined {
  if (rows.some((row) => row.value < 0)) return;
  const total = rows.reduce((result, row) => result + BigInt(row.value), 0n);
  if (!total) return;
  const shares = rows.map((row, index) => ({
    index,
    value: Number((BigInt(row.value) * 10000n) / total),
    remainder: (BigInt(row.value) * 10000n) % total,
  }));
  let extra = 10000 - shares.reduce((result, row) => result + row.value, 0);
  for (const share of [...shares].sort((a, b) =>
    a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : a.index - b.index,
  )) {
    if (extra-- <= 0) break;
    share.value++;
  }
  return shares.map((share) => share.value);
}

export function statisticAverage(value: number, days: number): number {
  if (!Number.isSafeInteger(value) || !Number.isInteger(days) || days < 1) throw new Error('无效日均范围');
  // 只用于展示，正负对称地取到整数分，不改写任何交易金额。
  return Math.sign(value) * Number((BigInt(Math.abs(value)) + BigInt(Math.floor(days / 2))) / BigInt(days));
}

import { list, put, type Entry, type Entity, type Rule, type State } from './model';
import { saveEntry } from './ledger';
import { dayAdd, localTime, monthDate, today } from './time';

function scheduled(rule: Rule, day: string): boolean {
  if (day < rule.start || (rule.end && day > rule.end)) return false;
  if (rule.frequency === 'daily') return true;
  if (rule.frequency === 'weekly')
    return (
      (Date.parse(`${day}T12:00:00+08:00`) - Date.parse(`${rule.start}T12:00:00+08:00`)) % (7 * 86400000) ===
      0
    );
  if (rule.frequency === 'yearly' && day.slice(5, 7) !== rule.start.slice(5, 7)) return false;
  return day === monthDate(day.slice(0, 7), Number(rule.start.slice(8)));
}
export function dueOccurrences(rule: Rule, until: string): string[] {
  const result: string[] = [];
  let day = rule.cursor > rule.start ? rule.cursor : rule.start;
  // 单次补生成有明确上限，超长规则保留进度，避免阻塞主线程。
  for (let n = 0; day <= until && n < 36600; n++, day = dayAdd(day, 1))
    if (scheduled(rule, day)) result.push(day);
  return result;
}
export function generateDue(state: State, now = new Date()): number {
  let count = 0;
  for (const entity of list(state, 'rule')) {
    const rule = entity.data;
    if (rule.paused) continue;
    const through = localTime(now).slice(11, 16) >= rule.time ? today(now) : dayAdd(today(now), -1);
    if (rule.cursor > through) continue;
    if (Date.parse(through) - Date.parse(rule.cursor) > 36599 * 86400000)
      throw new Error('周期起始日过早，请检查规则');
    for (const day of dueOccurrences(rule, through)) {
      const id = `occurrence:${entity.id}:${day}`;
      if (state.entities[id]) continue; // 删除标记同样占据期次，重试和旧设备不能重新生成。
      const entry: Entry = {
        ...rule.template,
        ledgerId: rule.ledgerId,
        at: `${day}T${rule.time}:00`,
        createdAt: localTime(now),
        source: { ruleId: entity.id, occurrence: day },
      };
      delete entry.manualCategoryAt;
      saveEntry(state, entry, id, false);
      count++;
    }
    put(state, { ...rule, cursor: dayAdd(through, 1) }, entity.id);
  }
  return count;
}
export function saveRule(state: State, rule: Rule, id?: string, now = new Date()): Entity<Rule> {
  // 先按旧规则补齐到期账，再更新未来；暂停期间不追补。
  if (id) generateDue(state, now);
  const previous = id ? state.entities[id]?.data : undefined;
  if (previous?.kind === 'rule')
    rule = { ...rule, cursor: previous.paused && !rule.paused ? today(now) : previous.cursor };
  return put(state, rule, id) as Entity<Rule>;
}
export type FinancialEvent = {
  id: string;
  day: string;
  name: string;
  sourceId: string;
  kind: 'loan' | 'account' | 'rule';
  amount?: number;
};
export function events(state: State, now = new Date()): FinancialEvent[] {
  const result: FinancialEvent[] = [];
  const entries = list(state, 'entry');
  for (const entry of entries)
    if (entry.data.due && ['borrow', 'lend'].includes(entry.data.type)) {
      const settled = entries
        .filter((x) => x.data.settlesId === entry.id)
        .reduce((s, x) => s + x.data.amount - x.data.interest, 0);
      if (settled < entry.data.amount)
        result.push({
          id: entry.id,
          day: entry.data.due,
          name: entry.data.type === 'borrow' ? '约定还款 · 待核对' : '约定收回 · 待核对',
          kind: 'loan',
          sourceId: entry.id,
          amount: entry.data.amount - settled,
        });
    }
  for (const account of list(state, 'account'))
    if (account.data.repaymentDay)
      result.push({
        id: account.id,
        day: monthDate(today(now).slice(0, 7), account.data.repaymentDay),
        name: `${account.data.name} · 还款日待核对`,
        kind: 'account',
        sourceId: account.id,
      });
  for (const rule of list(state, 'rule'))
    if (!rule.data.paused) {
      const next = dueOccurrences(rule.data, dayAdd(today(now), 370))[0];
      if (next)
        result.push({
          id: rule.id,
          day: next,
          name: rule.data.name,
          kind: 'rule',
          sourceId: rule.id,
          amount: rule.data.template.amount,
        });
    }
  return result.sort((a, b) => a.day.localeCompare(b.day));
}

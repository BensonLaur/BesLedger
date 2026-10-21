import builtin from '../../docs/examples/builtin-categories.json';
import { list, type State } from './model';

export type CategoryOption = {
  id: string;
  name: string;
  group: string;
  icon: string;
  type: 'expense' | 'income';
};
export const builtins: CategoryOption[] = [
  ...builtin.expense.flatMap((g) =>
    g.categories.map((c) => ({ ...c, group: g.name, type: 'expense' as const })),
  ),
  ...builtin.income.map((c) => ({ ...c, group: '收入', type: 'income' as const })),
];
export function categories(state: State, ledgerId: string): CategoryOption[] {
  return [
    ...builtins,
    ...list(state, 'category')
      .filter((x) => x.data.ledgerId === ledgerId)
      .map((x) => ({ ...x.data, id: x.id })),
  ];
}
export function quickCategories(
  state: State,
  ledgerId: string,
  type: 'expense' | 'income',
  now = new Date(),
): string[] {
  const defaults = builtin.defaultQuick[type];
  const uses = list(state, 'entry').filter(
    (e) => e.data.ledgerId === ledgerId && e.data.type === type && e.data.manualCategoryAt,
  );
  const valid = new Set(
    categories(state, ledgerId)
      .filter((c) => c.type === type)
      .map((c) => c.id),
  );
  const previous = state.preferences.quick[`${ledgerId}:${type}`] ?? defaults;
  const order = [...new Set([...previous, ...defaults, ...uses.map((e) => e.data.categoryId)])].filter((id) =>
    valid.has(id),
  );
  const score = (id: string) =>
    [7, 30, 365].reduce((s, d, index) => {
      const within = uses.filter((e) => {
        const age = now.valueOf() - Date.parse(`${e.data.manualCategoryAt}+08:00`);
        return age >= 0 && age < d * 86400000;
      });
      return (
        s +
        ([0.6, 0.3, 0.1][index] *
          (within.filter((e) => e.data.categoryId === id).length +
            (defaults.includes(id) ? 5 / defaults.length : 0))) /
          (within.length + 5)
      );
    }, 0);
  const scores = new Map(order.map((id) => [id, score(id)]));
  for (let i = 1; i < order.length; i++)
    for (let j = i; j > 0 && scores.get(order[j])! > scores.get(order[j - 1])! + 0.02; j--)
      [order[j], order[j - 1]] = [order[j - 1], order[j]];
  return order;
}
export function categoryName(state: State, ledgerId: string, categoryId: string): string {
  return categories(state, ledgerId).find((c) => c.id === categoryId)?.name ?? '待分类';
}

import { categories } from '../domain/categories';
import type { Entry, State } from '../domain/model';

export const loanIcons: Record<string, string> = {
  borrow: 'arrow-down-left',
  lend: 'arrow-up-right',
  repay: 'undo-2',
  collect: 'redo-2',
};
export const transferIcons: Record<string, string> = {
  转账: 'transfer',
  投资: 'chart',
  赎回: 'arrow-down-to-line',
  存钱: 'piggy-bank',
  取钱: 'arrow-up-from-line',
};
export function entryIcon(state: State, entry: Entry): string {
  if (loanIcons[entry.type]) return loanIcons[entry.type];
  if (entry.type === 'transfer') return transferIcons[entry.behavior] || 'transfer';
  return (
    categories(state, entry.ledgerId).find((c) => c.id === entry.categoryId)?.icon ||
    (entry.type === 'income' ? 'income' : 'shapes')
  );
}

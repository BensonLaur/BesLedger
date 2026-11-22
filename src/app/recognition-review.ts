import { categories } from '../domain/categories';
import type { Entry, State } from '../domain/model';
import { minor } from '../domain/money';
import type { Recognition } from '../recognition/sms';

export type RecognitionProtection = {
  amount: boolean;
  category: boolean;
  at: boolean;
  from: boolean;
  to: boolean;
  type: boolean;
};
export type ReviewedRecognition = {
  type: Entry['type'];
  amount?: number;
  categoryId: string;
  at: string;
  accountId: string;
  side: 'from' | 'to';
  changed: { amount: boolean; category: boolean; at: boolean; account: boolean };
};

export function reviewAmount(value: string): number | undefined {
  try {
    const amount = minor(value);
    return amount > 0 ? amount : undefined;
  } catch {
    return undefined;
  }
}

/** 预览展示将采用的值；自动模式受保护的手填值优先，不展示成即将被覆盖。 */
export function recognitionPreview(
  result: Recognition,
  draft: Entry,
  amount: string,
  automatic: boolean,
  protectedFields: RecognitionProtection,
  state: State,
): ReviewedRecognition {
  const twoAccounts = ['transfer', 'borrow', 'lend', 'repay', 'collect'].includes(draft.type);
  const type =
    !twoAccounts && (!automatic || !protectedFields.type) && result.type ? result.type : draft.type;
  const side = ['income', 'refund', 'collect', 'borrow'].includes(type) ? 'to' : 'from';
  const available = categories(state, draft.ledgerId).filter(
    (category) => category.type === (type === 'income' ? 'income' : 'expense'),
  );
  const currentCategory = available.some((category) => category.id === draft.categoryId)
    ? draft.categoryId
    : '';
  const candidateCategory =
    result.categoryIds.length === 1 && available.some((category) => category.id === result.categoryIds[0])
      ? result.categoryIds[0]
      : currentCategory;
  return {
    type,
    amount:
      automatic && protectedFields.amount ? reviewAmount(amount) : (result.amount ?? reviewAmount(amount)),
    categoryId: automatic && protectedFields.category ? currentCategory : candidateCategory,
    at: automatic && protectedFields.at ? draft.at : result.at || draft.at,
    accountId:
      automatic && protectedFields[side]
        ? draft[side]
        : result.accountIds.length === 1
          ? result.accountIds[0]
          : draft[side],
    side,
    changed: { amount: false, category: false, at: false, account: false },
  };
}

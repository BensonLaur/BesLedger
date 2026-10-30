import type { Recognition } from '../recognition/sms';
import type { Entry } from '../domain/model';

export type AutomaticFieldContext = {
  type: Entry['type'];
  protectedAmount: boolean;
  protectedCategory: boolean;
  automaticAmount: boolean;
  automaticCategory: boolean;
};
export function automaticFields(result: Recognition, context: AutomaticFieldContext) {
  const amount = context.protectedAmount
    ? undefined
    : result.amountCertain && result.amount !== undefined
      ? result.amount
      : context.automaticAmount
        ? null
        : undefined;
  const matchingType = !result.type || result.type === context.type;
  const categoryId = context.protectedCategory
    ? undefined
    : matchingType && ['expense', 'income'].includes(context.type) && result.categoryIds.length === 1
      ? result.categoryIds[0]
      : context.automaticCategory
        ? null
        : undefined;
  // null 只清除上一版自动填的值；手动值和原记录始终由保护标记挡住。
  return { amount, categoryId };
}

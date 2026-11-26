import type { Recognition } from '../recognition/sms';
import type { Entry } from '../domain/model';

export type AutomaticFieldContext = {
  type: Entry['type'];
  protectedAmount: boolean;
  protectedCategory: boolean;
  protectedAt: boolean;
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
    : matchingType &&
        ['expense', 'income'].includes(context.type) &&
        !result.categoryNeedsReview &&
        result.categoryIds.length === 1
      ? result.categoryIds[0]
      : context.automaticCategory
        ? null
        : undefined;
  // 缺少年份可先填候选时间，但保存前仍确认年份；多个时刻和未来日期留给核对面板。
  const at =
    !context.protectedAt &&
    !result.dateAmbiguous &&
    !result.warnings.some((warning) => warning.includes('时间晚于今天'))
      ? result.at
      : undefined;
  // null 只清除上一版自动填的值；手动值和原记录始终由保护标记挡住。
  return { amount, categoryId, at };
}

export type AutomaticAccountContext = {
  type: Entry['type'];
  protectedFrom: boolean;
  protectedTo: boolean;
  automaticFrom: boolean;
  automaticTo: boolean;
  availableIds: readonly string[];
};

/** 单边收支可明确定位账户；转账、借贷不能仅凭一个尾号推断两端资金方向。 */
export function automaticAccount(
  result: Recognition,
  context: AutomaticAccountContext,
): { side: 'from' | 'to'; accountId: string | null } | undefined {
  const side =
    context.type === 'expense' ? 'from' : ['income', 'refund'].includes(context.type) ? 'to' : undefined;
  if (!side || (side === 'from' ? context.protectedFrom : context.protectedTo)) return;
  const matchingType = !result.type || result.type === context.type;
  if (matchingType && result.accountIds.length === 1 && context.availableIds.includes(result.accountIds[0]))
    return { side, accountId: result.accountIds[0] };
  // 不从多个候选中筛一个自动采用；失去唯一匹配时只撤回旧自动值，手选值受独立保护。
  if (side === 'from' ? context.automaticFrom : context.automaticTo) return { side, accountId: null };
}

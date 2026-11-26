import { expect, it } from 'vitest';
import {
  automaticAccount,
  automaticFields,
  type AutomaticFieldContext,
  type AutomaticAccountContext,
} from '../src/app/automatic-recognition';
import { recognize } from '../src/recognition/sms';
const context: AutomaticFieldContext = {
  type: 'expense',
  protectedAmount: false,
  protectedCategory: false,
  protectedAt: false,
  automaticAmount: false,
  automaticCategory: false,
};
const parse = (text: string) => recognize(text, [], new Date('2026-10-30T12:00:00+08:00'));
it.each([
  [{}, { amount: 1000, categoryId: 'expense.transport.004' }],
  [{ protectedAmount: true }, { amount: undefined, categoryId: 'expense.transport.004' }],
  [{ protectedCategory: true }, { amount: 1000, categoryId: undefined }],
  [
    { protectedAmount: true, protectedCategory: true },
    { amount: undefined, categoryId: undefined },
  ],
] as const)('明确金额和分类按独立保护标记处理 %j', (overrides, expected) => {
  expect(automaticFields(parse('停车费10元'), { ...context, ...overrides })).toEqual({
    ...expected,
    at: undefined,
  });
});

const accountContext: AutomaticAccountContext = {
  type: 'expense',
  protectedFrom: false,
  protectedTo: false,
  automaticFrom: false,
  automaticTo: false,
  availableIds: ['bank', 'another-bank'],
};

it.each([
  ['expense', 'from'],
  ['income', 'to'],
  ['refund', 'to'],
] as const)('%s 唯一账户按实际收支方向直接填入 %s，不改变识别证据', (type, side) => {
  const result = { ...parse('停车费10元'), type, accountIds: ['bank'] };
  const before = structuredClone(result);
  expect(automaticAccount(result, { ...accountContext, type })).toEqual({ side, accountId: 'bank' });
  expect(result).toEqual(before);
});

it.each([{ accountIds: [] }, { accountIds: ['bank', 'another-bank'] }, { accountIds: ['deleted-bank'] }])(
  '%j 未匹配、多候选或账户已不可用时只撤回旧自动值',
  ({ accountIds }) => {
    const result = { ...parse('停车费10元'), accountIds };
    expect(automaticAccount(result, accountContext)).toBeUndefined();
    expect(automaticAccount(result, { ...accountContext, automaticFrom: true })).toEqual({
      side: 'from',
      accountId: null,
    });
  },
);

it.each(['expense', 'income', 'refund'] as const)(
  '%s 手选或原记录账户受保护，不因匹配和清空而覆盖',
  (type) => {
    for (const accountIds of [[], ['bank'], ['bank', 'another-bank']]) {
      const result = { ...parse('停车费10元'), type, accountIds };
      expect(
        automaticAccount(result, {
          ...accountContext,
          type,
          protectedFrom: true,
          protectedTo: true,
          automaticFrom: true,
          automaticTo: true,
        }),
      ).toBeUndefined();
    }
  },
);

it.each(['transfer', 'borrow', 'lend', 'repay', 'collect'] as const)(
  '%s 不凭单个匹配尾号自动推断两端账户',
  (type) => {
    const result = { ...parse('停车费10元'), type: undefined, accountIds: ['bank'] };
    expect(automaticAccount(result, { ...accountContext, type })).toBeUndefined();
  },
);

it('识别类型与当前类型不一致时不把收款银行卡填到付款端，不能从多候选过滤成唯一项', () => {
  const result = { ...parse('工资6000元'), accountIds: ['bank'] };
  expect(automaticAccount(result, accountContext)).toBeUndefined();
  expect(automaticAccount(result, { ...accountContext, automaticFrom: true })).toEqual({
    side: 'from',
    accountId: null,
  });
  expect(
    automaticAccount({ ...result, type: 'expense', accountIds: ['bank', 'deleted-bank'] }, accountContext),
  ).toBeUndefined();
});
it('多金额多分类撤回旧自动值，原有/手动字段即使清空也不被重填', () => {
  const result = parse('早餐10元，午餐20元');
  expect(automaticFields(result, { ...context, automaticAmount: true, automaticCategory: true })).toEqual({
    amount: null,
    categoryId: null,
    at: undefined,
  });
  expect(
    automaticFields(result, {
      ...context,
      protectedAmount: true,
      protectedCategory: true,
      automaticAmount: true,
      automaticCategory: true,
    }),
  ).toEqual({ amount: undefined, categoryId: undefined, at: undefined });
});
it.each(['停车费10', '停车费1.234元', '停车费USD10元', '停车费支付失败10元', '停车费0元'])(
  '%s 不自动猜测金额，但可以独立建议用途',
  (text) => {
    expect(automaticFields(parse(text), context).amount).toBeUndefined();
    expect(automaticFields(parse(text), { ...context, automaticAmount: true }).amount).toBeNull();
  },
);
it('唯一实付值可直接填入，不使用优惠或余额，也不改写识别证据', () => {
  const result = parse('停车费原价20元，优惠5元，实付15元，余额100元'),
    before = structuredClone(result);
  expect(automaticFields(result, context)).toEqual({
    amount: 1500,
    categoryId: 'expense.transport.004',
    at: undefined,
  });
  expect(result).toEqual(before);
});
it('类型不一致时不塞入另一类分类，转账和借贷不自动加入消费分类', () => {
  const salary = parse('工资6000元');
  expect(automaticFields(salary, context)).toEqual({ amount: 600000, categoryId: undefined, at: undefined });
  for (const type of ['transfer', 'borrow', 'repay'] as const)
    expect(automaticFields(parse('停车费10元'), { ...context, type }).categoryId).toBeUndefined();
});

it.each([
  ['2026年10月14日08:20停车费10元', '2026-10-14T08:20:00', 'explicitText'],
  ['2026/10/14 08:20:12停车费10元', '2026-10-14T08:20:12', 'explicitText'],
  ['10月14日08:20停车费10元', '2026-10-14T08:20:00', 'referenceDateCandidate'],
  ['12月14日08:20停车费10元', '2025-12-14T08:20:00', 'previousYearCandidate'],
])('%s 先填唯一有效时间并保留年份依据，独立保护手调和原记录时间', (text, at, basis) => {
  const result = parse(text);
  const before = structuredClone(result);
  expect(automaticFields(result, context).at).toBe(at);
  expect(automaticFields(result, { ...context, protectedAt: true }).at).toBeUndefined();
  expect(result.yearBasis).toBe(basis);
  expect(result).toEqual(before);
});

it.each(['停车费10元', '08:20停车费10元', '2026年2月30日08:20停车费10元', '2027年1月1日08:20停车费10元'])(
  '%s 缺少完整日期、日期无效或晚于今天时不自动改时间',
  (text) => expect(automaticFields(parse(text), context).at).toBeUndefined(),
);

it.each([
  '2026年10月14日08:20停车费10元，通知时间2026年10月15日09:30',
  '2026/10/14 08:20停车费10元，通知时间10月15日09:30',
])('%s 多个日期只留首项候选供核对，不自动填入任意时间', (text) => {
  const result = parse(text);
  expect(result.dateAmbiguous).toBe(true);
  expect(result.at).toBe('2026-10-14T08:20:00');
  expect(automaticFields(result, context).at).toBeUndefined();
  expect(result.warnings.join()).toContain('多个日期时间');
});

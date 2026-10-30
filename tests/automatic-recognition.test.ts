import { expect, it } from 'vitest';
import { automaticFields, type AutomaticFieldContext } from '../src/app/automatic-recognition';
import { recognize } from '../src/recognition/sms';
const context: AutomaticFieldContext = {
  type: 'expense',
  protectedAmount: false,
  protectedCategory: false,
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
  expect(automaticFields(parse('停车费10元'), { ...context, ...overrides })).toEqual(expected);
});
it('多金额多分类撤回旧自动值，原有/手动字段即使清空也不被重填', () => {
  const result = parse('早餐10元，午餐20元');
  expect(automaticFields(result, { ...context, automaticAmount: true, automaticCategory: true })).toEqual({
    amount: null,
    categoryId: null,
  });
  expect(
    automaticFields(result, {
      ...context,
      protectedAmount: true,
      protectedCategory: true,
      automaticAmount: true,
      automaticCategory: true,
    }),
  ).toEqual({ amount: undefined, categoryId: undefined });
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
  expect(automaticFields(result, context)).toEqual({ amount: 1500, categoryId: 'expense.transport.004' });
  expect(result).toEqual(before);
});
it('类型不一致时不塞入另一类分类，转账和借贷不自动加入消费分类', () => {
  const salary = parse('工资6000元');
  expect(automaticFields(salary, context)).toEqual({ amount: 600000, categoryId: undefined });
  for (const type of ['transfer', 'borrow', 'repay'] as const)
    expect(automaticFields(parse('停车费10元'), { ...context, type }).categoryId).toBeUndefined();
});

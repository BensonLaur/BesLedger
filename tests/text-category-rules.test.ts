import { expect, it } from 'vitest';
import { recognize } from '../src/recognition/sms';
import {
  autoThreeMealsRuleTarget,
  firstCategoryRule,
  validCategoryPattern,
  type CategoryRule,
} from '../src/recognition/text-category-rules';

const broad = {
  pattern: '示例小区',
  categoryId: 'expense.transport.004',
  type: 'expense',
} satisfies CategoryRule;
const specific = { ...broad, pattern: 'Ａ区*东门', categoryId: 'expense.food.009' };
const income = { ...broad, categoryId: 'income.001', type: 'income' } satisfies CategoryRule;

it('字面包含与通配均可命中，重叠规则按从上到下顺序，且按交易方向过滤', () => {
  const note = '付款：示例小区a区\n临时通道东门';
  expect(firstCategoryRule(note, 'expense', [income, broad, specific])).toBe(broad);
  expect(firstCategoryRule(note, 'expense', [specific, broad])).toBe(specific);
  expect(firstCategoryRule('A区东门', 'expense', [specific])).toBe(specific);
  expect(firstCategoryRule('东门A区', 'expense', [specific])).toBeUndefined();
  expect(firstCategoryRule('示例小区', 'income', [broad, income])).toBe(income);
  expect(firstCategoryRule('ss', 'expense', [{ ...broad, pattern: '.+' }])).toBeUndefined();
});

it('空规则和纯通配规则不可保存，也不会匹配导入的旧数据', () => {
  for (const pattern of ['', '  ', '＊ *']) {
    expect(validCategoryPattern(pattern)).toBe(false);
    expect(firstCategoryRule('示例小区', 'expense', [{ ...broad, pattern }])).toBeUndefined();
  }
  expect(validCategoryPattern('示例小区*东门')).toBe(true);
  expect(validCategoryPattern('字'.repeat(121))).toBe(false);
});

it('规则优先于内置用途词，只决定分类，退款和转账不命中', () => {
  const options = { categoryRules: [broad, income], fallbackType: 'expense' as const };
  const recognizeWithRules = (note: string) =>
    recognize(note, [], new Date('2026-11-22T12:00:00+08:00'), options);
  expect(recognizeWithRules('2026年11月20日18:10支出示例小区晚餐25元')).toMatchObject({
    categoryIds: [broad.categoryId],
    categoryRulePattern: broad.pattern,
    type: 'expense',
    amount: 2500,
    at: '2026-11-20T18:10:00',
  });
  expect(recognizeWithRules('示例小区').categoryIds).toEqual([broad.categoryId]);
  expect(recognizeWithRules('示例小区到账20元').categoryIds).toEqual([income.categoryId]);
  expect(recognizeWithRules('示例小区退款25元').categoryRulePattern).toBeUndefined();
  expect(recognizeWithRules('示例小区转账50元').categoryRulePattern).toBeUndefined();
});

const mealRule = {
  pattern: '示例餐馆',
  categoryId: autoThreeMealsRuleTarget.id,
  type: 'expense',
} satisfies CategoryRule;
const mealOptions = {
  categoryRules: [mealRule, { ...broad, pattern: mealRule.pattern }],
};
const recognizeMeal = (text: string) =>
  recognize(text, [], new Date('2026-11-22T12:00:00+08:00'), mealOptions);

it.each([
  ['05:00', 'expense.food.001'],
  ['10:59', 'expense.food.001'],
  ['11:00', 'expense.food.002'],
  ['14:59', 'expense.food.002'],
  ['17:00', 'expense.food.003'],
  ['20:59', 'expense.food.003'],
])('三餐规则按交易时段 %s 归到实际分类 %s', (time, categoryId) => {
  const result = recognizeMeal(`2026年11月20日${time}支出示例餐馆25元`);
  expect(result.categoryIds).toEqual([categoryId]);
  expect(result.categoryRulePattern).toBe(mealRule.pattern);
  expect(result.categoryNeedsReview).toBeUndefined();
});

it.each([
  '示例餐馆支出25元',
  '15:00支出示例餐馆25元',
  '16:59支出示例餐馆25元',
  '21:00支出示例餐馆25元',
  '04:59支出示例餐馆25元',
  '2026年2月30日08:20支出示例餐馆25元',
  '08:20支出示例餐馆25元，另一个时间11:30',
])('无法凭原文确定三餐时给候选并保留规则优先级：%s', (text) => {
  const result = recognizeMeal(text);
  expect(result.categoryIds).toEqual(['expense.food.001', 'expense.food.002', 'expense.food.003']);
  expect(result.categoryNeedsReview).toBe(true);
  expect(result.categoryRulePattern).toBe(mealRule.pattern);
});

it('明确餐次优先，多个餐次留给用户，收入不受三餐规则影响', () => {
  expect(recognizeMeal('19:30支出示例餐馆早膳25元').categoryIds).toEqual(['expense.food.001']);
  expect(recognizeMeal('08:20支出示例餐馆午餐和晚餐25元').categoryIds).toEqual([
    'expense.food.002',
    'expense.food.003',
  ]);
  expect(recognizeMeal('12:30示例餐馆收入25元').categoryRulePattern).toBeUndefined();
});

import { expect, it } from 'vitest';
import { recognize } from '../src/recognition/sms';
import { fixture } from './fixtures';
import { list } from '../src/domain/model';
const now = new Date('2026-10-30T12:00:00+08:00');
const parse = (text: string) => recognize(text, list(fixture(), 'account'), now);
const meals = ['expense.food.001', 'expense.food.002', 'expense.food.003', 'expense.food.004'];

it('虚构银行通知先识别包點餐饮用途，再按原文时间推荐早餐，金额、余额和银行卡独立提取', () => {
  const text = '尾号1234卡10月14日08:20支出(消费财付通-示例包點店)6.80元，余额2,345.67元。【工商银行】';
  const r = parse(text);
  expect(r.amount).toBe(680);
  expect(r.balance).toBe(234567);
  expect(r.accountIds).toEqual(['bank']);
  expect(r.categoryIds).toEqual(['expense.food.001']);
  expect(r.at).toBe('2026-10-14T08:20:00');
  expect(r.yearBasis).toBe('referenceDateCandidate');
  expect(r.warnings.join()).toContain('按备注时间 08:20 推荐早餐');
});
it.each([
  ['08:20 包點12元', 'expense.food.001'],
  ['8:20 包点12元', 'expense.food.001'],
  ['08:20 包子12元', 'expense.food.001'],
  ['08:20 豆漿12元', 'expense.food.001'],
  ['08:20 肠粉12元', 'expense.food.001'],
  ['08:20 食堂12元', 'expense.food.001'],
  ['12:30 餐廳12元', 'expense.food.002'],
  ['19:20 外卖12元', 'expense.food.003'],
  ['22:30 吃饭12元', 'expense.food.004'],
  ['19:20 包點12元', 'expense.food.003'],
  ['04:59 餐厅12元', 'expense.food.004'],
  ['05:00 餐厅12元', 'expense.food.001'],
  ['10:59:59 餐厅12元', 'expense.food.001'],
  ['11:00 餐厅12元', 'expense.food.002'],
  ['14:59 餐厅12元', 'expense.food.002'],
  ['17:00 餐厅12元', 'expense.food.003'],
  ['20:59 餐厅12元', 'expense.food.003'],
  ['21:00 餐厅12元', 'expense.food.004'],
  ['00:00 餐厅12元', 'expense.food.004'],
])('%s 按明示时段推荐 %s，纯时间备注保留草稿日期', (text, category) => {
  const r = parse(text);
  expect(r.amount).toBe(1200);
  expect(r.categoryIds).toEqual([category]);
  expect(r.warnings.join()).toContain('按备注时间');
  expect(r.at).toBeUndefined();
});
it.each([
  '包點12元',
  '包子12元',
  '豆浆12元',
  '餐厅12元',
  '15:00 餐厅12元',
  '16:59 餐厅12元',
  '24:00 餐厅12元',
  '08:80 餐厅12元',
  '08:20:99 餐厅12元',
  '2026年2月30日08:20 餐厅12元',
  '08:20 餐厅12元，19:20处理',
])('%s 没有唯一可靠用餐时段，不把当前补账时间当消费时间', (text) => {
  const r = parse(text);
  expect(r.categoryIds).toEqual(meals);
  expect(r.warnings.join()).toContain('用餐时段不明确');
  expect(r.warnings.join()).not.toContain('按备注时间');
});
it.each([
  ['19:20 早餐包点12元', 'expense.food.001'],
  ['08:20 午餐食堂12元', 'expense.food.002'],
  ['08:20 晚餐餐厅12元', 'expense.food.003'],
  ['08:20 夜宵12元', 'expense.food.004'],
  ['08:20 奶茶12元', 'expense.food.006'],
  ['08:20 停车费12元', 'expense.transport.004'],
])('%s 明确用途优先于时间', (text, category) => {
  expect(parse(text).categoryIds).toEqual([category]);
  expect(parse(text).warnings.join()).not.toContain('按备注时间');
});
it('支付渠道与时段不足以判定餐饮；收入、退款和用户商户规则不被餐次推荐覆盖', () => {
  expect(parse('08:20 消费财付通12元').categoryIds).toEqual([]);
  expect(parse('08:20 收到餐费12元').categoryIds).toEqual([]);
  expect(parse('08:20 退款包點12元').categoryIds).toEqual([]);
  expect(parse('08:20 超市12元').categoryIds).toHaveLength(2);
  const r = recognize('08:20 示例包點店12元', [], now, { 示例包點店: 'expense.food.009' });
  expect(r.categoryIds).toEqual(['expense.food.009']);
  expect(r.warnings.join()).not.toContain('推荐早餐');
});

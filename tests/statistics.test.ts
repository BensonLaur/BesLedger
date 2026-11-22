import { describe, expect, it } from 'vitest';
import { builtins } from '../src/domain/categories';
import { put, type Entity, type Entry } from '../src/domain/model';
import { totals } from '../src/domain/ledger';
import {
  statisticAverage,
  statisticIdentity,
  statisticRange,
  statisticRows,
  statisticShares,
} from '../src/domain/statistics';
import { fixture, entry } from './fixtures';

const now = '2026-11-22';
function sample(overrides: Partial<Entry>[] = []) {
  const state = fixture();
  return overrides.map((data) => put(state, entry(state, data))) as Entity<Entry>[];
}
const range = (
  mode: 'month' | 'year' | 'all' | 'custom',
  from = '2026-11-01',
  through = '2026-11-22',
  entries: Entity<Entry>[] = [],
) => statisticRange(mode, '2026-11', '2026', { from, through }, entries, now);

describe('统计区间和完整时间轴', () => {
  it('月与年按自然日计算，闰年二月和跨年自定义保持正确', () => {
    expect(range('month')).toEqual({ from: '2026-11-01', through: '2026-11-30', grain: 'day', days: 30 });
    expect(range('year').days).toBe(365);
    expect(statisticRange('month', '2028-02', '2028', { from: '', through: '' }, [], now).days).toBe(29);
    expect(range('custom', '2025-12-31', '2026-01-02')).toMatchObject({ days: 3, grain: 'day' });
  });
  it.each([
    ['2026-02-30', '2026-03-01'],
    ['2026-11-23', '2026-11-22'],
    ['', '2026-11-22'],
    ['0000-01-01', '2026-11-22'],
  ])('拒绝无效区间 %s → %s', (from, through) => {
    expect(() => range('custom', from, through)).toThrow('请选择有效');
  });
  it('全部时间从首笔开始，长历史改为年，不遍历每天', () => {
    const entries = sample([{ at: '2010-01-02T12:00:00' }, { at: '2026-11-01T12:00:00' }]);
    expect(range('all', '', '', entries)).toMatchObject({ from: '2010-01-02', through: now, grain: 'year' });
    expect(
      statisticRows(entries, range('all', '', '', entries), 'trend', 'expense', builtins, {}),
    ).toHaveLength(17);
  });
  it('空账及最大支持年份不产生无限循环，未记账日保留 count=0', () => {
    const rows = statisticRows([], range('month'), 'trend', 'expense', builtins, {});
    expect(rows).toHaveLength(30);
    expect(rows.every((row) => row.count === 0 && row.value === 0)).toBe(true);
    const edge = range('custom', '9999-12-30', '9999-12-31');
    expect(statisticRows([], edge, 'trend', 'expense', builtins, {})).toHaveLength(2);
  });
});

describe('统计复用现有收支口径', () => {
  const entries = sample([
    { type: 'expense', amount: 2000, categoryId: 'expense.food.001', at: '2026-11-01T08:00:00' },
    { type: 'expense', amount: 3000, categoryId: 'expense.food.002', at: '2026-11-01T12:00:00' },
    {
      type: 'refund',
      amount: 1000,
      categoryId: 'expense.food.001',
      from: '',
      to: 'bank',
      at: '2026-11-02T12:00:00',
    },
    {
      type: 'income',
      amount: 600000,
      from: '',
      to: 'bank',
      categoryId: 'income.001',
      at: '2026-11-03T12:00:00',
    },
    { type: 'transfer', amount: 99900, from: 'cash', to: 'bank', at: '2026-11-04T12:00:00' },
    { type: 'repay', amount: 11000, interest: 1000, at: '2026-11-05T12:00:00' },
    { type: 'collect', amount: 5500, interest: 500, at: '2026-11-06T12:00:00' },
  ]);
  it.each(['expense', 'income', 'net'] as const)(
    '%s 趋势、大类、小类和账户汇总同源，借还本金不计收支',
    (metric) => {
      const total = totals(entries.map((e) => e.data));
      for (const view of ['trend', 'group', 'category', 'account'] as const) {
        const rows = statisticRows(entries, range('month'), view, metric, builtins, {});
        expect(rows.reduce((sum, row) => sum + row.value, 0)).toBe(total[metric]);
      }
    },
  );
  it('大类合并早餐午餐，笔数包含退款且利息使用既有分类', () => {
    const rows = statisticRows(entries, range('month'), 'group', 'expense', builtins, {});
    expect(rows.find((row) => row.label === '餐饮')).toMatchObject({ value: 4000, count: 3 });
    const row = entries.find((e) => e.data.type === 'repay')!;
    expect(statisticIdentity(row.data, 'category', 'day', builtins)).toBe('expense.investment.001');
  });
  it('退款归入入账账户，零净支出仍保留发生笔数，自定义类别保留大类', () => {
    const data = sample([
      { amount: 1000, at: '2026-11-01T12:00:00', categoryId: 'custom' },
      { type: 'refund', amount: 1000, at: '2026-11-02T12:00:00', categoryId: 'custom', from: '', to: 'bank' },
    ]);
    const categories = [
      ...builtins,
      { id: 'custom', name: '虚构小类', group: '虚构大类', type: 'expense' as const, icon: 'receipt' },
    ];
    expect(statisticRows(data, range('month'), 'group', 'expense', categories, {})).toMatchObject([
      { label: '虚构大类', value: 0, count: 2 },
    ]);
    expect(
      statisticRows(data, range('month'), 'account', 'expense', categories, { bank: '虚构银行卡' }).find(
        (row) => row.id === 'bank',
      ),
    ).toMatchObject({ label: '虚构银行卡', value: -1000 });
  });
  it('删除记录、区间外记录不计入，未识别类别保持待分类', () => {
    const data = sample([{ at: '2026-10-01T12:00:00' }, { at: '2026-11-02T12:00:00', categoryId: '' }]);
    const rows = statisticRows(data, range('month'), 'category', 'expense', builtins, {});
    expect(rows).toMatchObject([{ label: '待分类', value: 1000, count: 1 }]);
    data[1].deleted = true;
    expect(statisticRows(data, range('month'), 'category', 'expense', builtins, {})).toHaveLength(0);
  });
});

describe('占比与日均展示边界', () => {
  it('万分比尾差稳定分配为100%，不改写输入', () => {
    const rows = [{ value: 1 }, { value: 1 }, { value: 1 }];
    expect(statisticShares(rows)).toEqual([3334, 3333, 3333]);
    expect(rows).toEqual([{ value: 1 }, { value: 1 }, { value: 1 }]);
    expect(statisticShares([{ value: 9007199254740990 }, { value: 1 }])).toEqual([10000, 0]);
  });
  it('负值和全零不生成错误占比', () => {
    expect(statisticShares([{ value: 100 }, { value: -10 }])).toBeUndefined();
    expect(statisticShares([{ value: 0 }])).toBeUndefined();
  });
  it('展示日均按整数分对称舍入，不写入账目', () => {
    expect(statisticAverage(1, 2)).toBe(1);
    expect(statisticAverage(-1, 2)).toBe(-1);
    expect(statisticAverage(100, 30)).toBe(3);
    expect(() => statisticAverage(1, 0)).toThrow();
  });
});

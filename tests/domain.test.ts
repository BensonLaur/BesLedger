import { describe, expect, it } from 'vitest';
import { fixture, entry } from './fixtures';
import { minor, sum } from '../src/domain/money';
import { accountBalance, deleteEntry, saveEntry, totals } from '../src/domain/ledger';
import { list, type Rule } from '../src/domain/model';
import { draftTime } from '../src/domain/time';
import { generateDue, saveRule } from '../src/domain/recurring';
import { calendarScale } from '../src/domain/reports';
import { recognize } from '../src/recognition/sms';
import { quickCategories } from '../src/domain/categories';

describe('金额与资金不变量', () => {
  it('十进制解析不损失分，拒绝精度截断与安全范围溢出', () => {
    expect(minor('6000.00')).toBe(600000);
    expect(sum([minor('0.10'), minor('0.20')])).toBe(30);
    expect(() => minor('1.001')).toThrow();
    expect(() => minor('90071992547409.92')).toThrow();
    expect(() => sum([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  });
  it('起算前的补账不重复增加期初；起算点交易与转账双端准确生效', () => {
    const s = fixture();
    saveEntry(s, entry(s, { amount: 500, at: '2025-12-31T23:59:59' }));
    saveEntry(s, entry(s, { type: 'transfer', amount: 2500, to: 'bank', at: '2026-01-01T00:00:00' }));
    expect(
      accountBalance(
        s,
        list(s, 'account').find((a) => a.id === 'cash')!,
      ),
    ).toBe(97500);
    expect(
      accountBalance(
        s,
        list(s, 'account').find((a) => a.id === 'bank')!,
      ),
    ).toBe(202500);
    expect(totals(list(s, 'entry').map((e) => e.data)).expense).toBe(500);
  });
  it('完整借还后往来归零，净资产只损失利息；修改删除整笔原子计算', () => {
    const s = fixture();
    saveEntry(s, entry(s, { type: 'borrow', from: 'person', to: 'cash', amount: 100000 }));
    const repayment = saveEntry(
      s,
      entry(s, { type: 'repay', from: 'cash', to: 'person', amount: 102000, interest: 2000 }),
    );
    const balance = (id: string) =>
      accountBalance(
        s,
        list(s, 'account').find((a) => a.id === id)!,
      );
    expect(balance('person')).toBe(0);
    expect(balance('cash')).toBe(98000);
    expect(totals(list(s, 'entry').map((x) => x.data))).toEqual({ income: 0, expense: 2000, net: -2000 });
    saveEntry(s, { ...repayment.data, amount: 2000 }, repayment.id);
    expect(balance('person')).toBe(-100000);
    expect(balance('cash')).toBe(198000);
    expect(() => saveEntry(s, { ...repayment.data, interest: 102001 }, repayment.id)).toThrow('利息');
    deleteEntry(s, repayment.id);
    expect(balance('cash')).toBe(200000);
  });
  it('部分退款跨账户跨月，只减少退款发生月支出，原单不会被减写', () => {
    const s = fixture();
    const original = saveEntry(s, entry(s, { amount: 100000 }));
    saveEntry(
      s,
      entry(s, {
        type: 'refund',
        amount: 20000,
        from: '',
        to: 'bank',
        originalId: original.id,
        at: '2026-11-01T12:00:00',
      }),
    );
    saveEntry(
      s,
      entry(s, {
        type: 'refund',
        amount: 15000,
        from: '',
        to: 'cash',
        originalId: original.id,
        at: '2026-11-02T12:00:00',
      }),
    );
    expect(original.data.amount).toBe(100000);
    expect(
      totals(
        list(s, 'entry')
          .filter((e) => e.data.at.startsWith('2026-11'))
          .map((e) => e.data),
      ).expense,
    ).toBe(-35000);
    expect(
      accountBalance(
        s,
        list(s, 'account').find((a) => a.id === 'bank')!,
      ),
    ).toBe(220000);
    expect(() => deleteEntry(s, original.id)).toThrow('关联退款');
    expect(() =>
      saveEntry(s, entry(s, { type: 'refund', amount: 66000, to: 'cash', originalId: original.id })),
    ).toThrow('累计退款');
  });
});
describe('时间、周期与展示', () => {
  it('选中历史日用中午，今天/整月用点击时钟，跨午夜不沿用旧今天', () => {
    const now = new Date('2026-10-21T15:59:59Z');
    expect(draftTime('2026-10-01', now)).toBe('2026-10-01T12:00:00');
    expect(draftTime('2026-10-21', now)).toBe('2026-10-21T23:59:59');
    expect(draftTime(undefined, now)).toBe('2026-10-21T23:59:59');
    expect(draftTime('2026-10-21', new Date('2026-10-21T16:00:01Z'))).toBe('2026-10-21T12:00:00');
  });
  it('补周期先使用旧规则；短月落月底，重试与删除不重生', () => {
    const s = fixture();
    const rule: Rule = {
      kind: 'rule',
      ledgerId: s.preferences.currentLedger,
      name: '虚构月账',
      start: '2026-01-31',
      cursor: '2026-01-31',
      frequency: 'monthly',
      paused: false,
      time: '12:00',
      template: entry(s),
    };
    const r = saveRule(s, rule);
    const now = new Date('2026-03-31T06:00:00Z');
    saveRule(s, { ...rule, template: entry(s, { amount: 2000 }) }, r.id, now);
    expect(list(s, 'entry').map((e) => e.data.at.slice(0, 10))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
    expect(list(s, 'entry').every((e) => e.data.amount === 1000)).toBe(true);
    deleteEntry(s, list(s, 'entry')[0].id);
    expect(generateDue(s, now)).toBe(0);
    expect(generateDue(s, new Date('2026-04-30T06:00:00Z'))).toBe(1);
    expect(list(s, 'entry').at(-1)!.data.amount).toBe(2000);
  });
  it('P90 日常刻度不会被单笔虚构大额拉平，空账本无伪造刻度', () => {
    const s = fixture();
    const values = Array.from({ length: 20 }, (_, n) =>
      entry(s, {
        at: `2026-10-${String(n + 1).padStart(2, '0')}T12:00:00`,
        amount: n === 19 ? 12000000 : 18300,
      }),
    );
    expect(calendarScale(values, '2026-10', 'expense', '2026-10-21')).toBe(20000);
    expect(calendarScale([], '2026-10', 'expense', '2026-10-21')).toBe(0);
  });
  it('分类频率以成功手工保存计数，修改金额不重复贡献，删除移除', () => {
    const s = fixture(),
      now = new Date('2026-10-21T04:00:00Z');
    const first = quickCategories(s, s.preferences.currentLedger, 'expense', now);
    const e = saveEntry(s, entry(s));
    const timestamp = e.data.manualCategoryAt;
    saveEntry(s, { ...e.data, amount: 2000 }, e.id);
    expect(list(s, 'entry')[0].data.manualCategoryAt).toBe(timestamp);
    deleteEntry(s, e.id);
    expect(quickCategories(s, s.preferences.currentLedger, 'expense', now)).toEqual(first);
  });
});
describe('短信字段证据', () => {
  it('支付渠道不会替换银行卡，交易与余额分开，跨年候选需确认', () => {
    const s = fixture();
    const r = recognize(
      '尾号1234卡12月31日23:58支出(消费财付通-示例包点)8.00元，余额1,500.00元。【工商银行】',
      list(s, 'account'),
      new Date('2026-01-02T00:00:00+08:00'),
    );
    expect(r.amount).toBe(800);
    expect(r.balance).toBe(150000);
    expect(r.accountIds).toEqual(['bank']);
    expect(r.at).toBe('2025-12-31T23:58:00');
    expect(r.warnings.some((x) => x.includes('年份'))).toBe(true);
  });
  it('缺金额不使用余额，无效日期不滚动，退款不成为收入', () => {
    const r = recognize(
      '尾号1234卡2026年2月30日08:09收入（退款）通知，余额2,000.00元。【工商银行】',
      list(fixture(), 'account'),
    );
    expect(r.amount).toBeUndefined();
    expect(r.balance).toBe(200000);
    expect(r.at).toBeUndefined();
    expect(r.type).toBe('refund');
  });
});

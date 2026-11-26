import { describe, expect, it } from 'vitest';
import { accountBalance, deleteEntry, saveEntry } from '../src/domain/ledger';
import { list, stateSchema } from '../src/domain/model';
import { prepareSmsBatch, reviewSmsDraft, saveSmsBatch, smsReviewContext } from '../src/domain/sms-import';
import { autoThreeMealsRuleTarget } from '../src/recognition/text-category-rules';
import { entry, fixture } from './fixtures';

const now = new Date('2026-11-22T23:00:00+08:00');
const bankSms = (date: string, merchant = '示例奶茶铺') =>
  `尾号1234卡${date}支出(消费财付通-${merchant})8.50元，余额500.00元。【工商银行】`;
const sample = bankSms('2026年11月20日12:20');

describe('批量短信记账', () => {
  it('排除提醒、促销、认证和失败通知，收支方向分别落到账户', async () => {
    const state = fixture();
    const ledger = state.preferences.currentLedger;
    const rows = await prepareSmsBatch(
      state,
      ledger,
      [
        { body: sample },
        { body: '尾号1234卡2026年11月20日09:20收入(示例工资本月)98元。【工商银行】' },
        { body: '尾号1234卡2026年11月20日12:20消费满8.50元领取优惠。【工商银行】' },
        { body: '尾号1234卡需于2026年11月20日12:20前还款，应还金额85元。【工商银行】' },
        { body: '请使用验证码确认登录。' + sample },
        { body: '尾号1234卡2026年11月20日12:20支付失败，金额8.50元。【工商银行】' },
      ],
      now,
    );
    expect(rows).toHaveLength(2);
    expect(saveSmsBatch(state, ledger, rows, now)).toBe(2);
    expect(list(state, 'entry').map(({ data }) => [data.from, data.to])).toEqual([
      ['bank', ''],
      ['', 'bank'],
    ]);
    expect(
      accountBalance(
        state,
        list(state, 'account').find(({ id }) => id === 'bank')!,
      ),
    ).toBe(208950);
    const saved = JSON.stringify(stateSchema.parse(state).entities);
    expect(saved).not.toContain('余额500');
    expect(saved).not.toContain(sample);
  });

  it('原文归一化后重查仍去重，不因同额合并不同时间的真实扣款', async () => {
    const state = fixture();
    const ledger = state.preferences.currentLedger;
    const rows = await prepareSmsBatch(
      state,
      ledger,
      [
        { body: sample },
        { body: sample.replace('支出(', ' 支出（').replace(')8.50', '）８.５０') },
        { body: bankSms('2026年11月20日12:21') },
      ],
      now,
    );
    expect(rows).toHaveLength(2);
    expect(saveSmsBatch(state, ledger, rows, now)).toBe(2);
    expect(saveSmsBatch(state, ledger, rows, now)).toBe(0);
    deleteEntry(state, rows[0].id);
    const again = await prepareSmsBatch(stateSchema.parse(state), ledger, [{ body: rows[0].body }], now);
    expect(reviewSmsDraft(again[0], smsReviewContext(state, ledger, now)).existing?.deleted).toBe(true);
    expect(saveSmsBatch(state, ledger, again, now)).toBe(0);
  });

  it('识别之前粘贴存过的原文，结构相同时要求确认且整批可安全重试', async () => {
    const state = fixture();
    const ledger = state.preferences.currentLedger;
    saveEntry(
      state,
      entry(state, { note: sample, from: 'bank', at: '2026-11-20T12:20:00', amount: 850 }),
      'old',
    );
    const rows = await prepareSmsBatch(
      state,
      ledger,
      [
        { body: sample },
        { body: bankSms('2026年11月20日12:20', '另一示例奶茶铺') },
        { body: bankSms('2026年11月20日12:21') },
      ],
      now,
    );
    const context = smsReviewContext(state, ledger, now, rows);
    const exact = rows.find((row) => row.body === sample)!;
    const possible = rows.find((row) => row.summary.startsWith('另一'))!;
    expect(reviewSmsDraft(exact, context).existing?.id).toBe('old');
    expect(reviewSmsDraft(possible, context).issue).toBe('疑似重复');
    expect(() => saveSmsBatch(state, ledger, rows, now)).toThrow('疑似重复');
    expect(list(state, 'entry')).toHaveLength(1);
    possible.acceptedDuplicate = reviewSmsDraft(possible, context).duplicateKey;
    expect(saveSmsBatch(state, ledger, rows, now)).toBe(2);
  });

  it('复用当前账本的三餐规则，用相近收件时间佐证年份，粘贴缺年份则待确认', async () => {
    const state = fixture();
    const ledger = state.preferences.currentLedger;
    state.preferences.textCategoryRules = {
      [ledger]: [{ pattern: '示例食堂', categoryId: autoThreeMealsRuleTarget.id }],
    };
    const body = bankSms('11月20日12:20', '示例食堂');
    const [received] = await prepareSmsBatch(
      state,
      ledger,
      [{ body, date: Date.parse('2026-11-20T12:22:00+08:00') }],
      now,
    );
    const [pasted] = await prepareSmsBatch(state, ledger, [{ body }], now);
    expect(pasted.id).toBe(received.id);
    expect(received.categoryId).toBe('expense.food.002');
    const context = smsReviewContext(state, ledger, now);
    expect(reviewSmsDraft(received, context).issue).toBe('');
    expect(reviewSmsDraft(pasted, context).issue).toBe('核对发生时间');
  });

  it('同批同账户同时间同额的不同短信仅在确认后可同时保存', async () => {
    const state = fixture();
    const ledger = state.preferences.currentLedger;
    const rows = await prepareSmsBatch(
      state,
      ledger,
      [{ body: sample }, { body: bankSms('2026年11月20日12:20', '另一个示例奶茶铺') }],
      now,
    );
    const review = reviewSmsDraft(rows[1], smsReviewContext(state, ledger, now, rows));
    expect(review.earlierRow?.id).toBe(rows[0].id);
    expect(review.issue).toBe('疑似重复');
    expect(() => saveSmsBatch(state, ledger, rows, now)).toThrow('疑似重复');
    expect(list(state, 'entry')).toHaveLength(0);
    rows[1].acceptedDuplicate = review.duplicateKey;
    expect(saveSmsBatch(state, ledger, rows, now)).toBe(2);
  });
});

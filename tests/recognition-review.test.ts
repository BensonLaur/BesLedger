import { describe, expect, it } from 'vitest';
import { recognitionPreview, reviewAmount, type RecognitionProtection } from '../src/app/recognition-review';
import { recognize } from '../src/recognition/sms';
import { emptyState, put, type Entry } from '../src/domain/model';
import { builtins } from '../src/domain/categories';

const state = emptyState();
put(state, { kind: 'ledger', name: '虚构核对测试' }, 'review-ledger');
const draft: Entry = {
  kind: 'entry',
  ledgerId: 'review-ledger',
  type: 'expense',
  amount: 0,
  interest: 0,
  from: 'manual-bank',
  to: 'manual-wallet',
  categoryId: builtins.find((category) => category.name === '早餐')!.id,
  at: '2026-11-22T12:00:00',
  note: '',
  behavior: '',
  createdAt: '2026-11-22T12:00:00',
};
const unprotected: RecognitionProtection = {
  amount: false,
  category: false,
  at: false,
  from: false,
  to: false,
  type: false,
};
describe('识别核对的有效值与手动保护', () => {
  it('自动模式展示实际保留的手动值，不能把识别值显示成将被采用的值', () => {
    const result = recognize('2026年10月14日08:20停车费10元', []);
    result.accountIds = ['recognized-bank'];
    const preview = recognitionPreview(
      result,
      draft,
      '77.00',
      true,
      { ...unprotected, amount: true, category: true, at: true, from: true },
      state,
    );
    expect(preview.amount).toBe(7700);
    expect(preview.categoryId).toBe(draft.categoryId);
    expect(preview.at).toBe(draft.at);
    expect(preview.accountId).toBe('manual-bank');
  });
  it('手动采用仍可预览明确的新金额和分类，不修改原草稿或识别结果', () => {
    const result = recognize('停车费10元', []),
      before = JSON.stringify({ draft, result });
    const preview = recognitionPreview(
      result,
      draft,
      '77.00',
      false,
      { ...unprotected, amount: true, category: true },
      state,
    );
    expect(preview.amount).toBe(1000);
    expect(preview.categoryId).toBe(builtins.find((category) => category.name === '停车费')!.id);
    expect(JSON.stringify({ draft, result })).toBe(before);
  });
  it('收入类型切换使用收款端及收入分类，不能保留不适用的支出分类', () => {
    const preview = recognitionPreview(recognize('工资6000元到账', []), draft, '', false, unprotected, state);
    expect(preview.type).toBe('income');
    expect(preview.side).toBe('to');
    expect(preview.amount).toBe(600000);
    expect(preview.categoryId).toBe(builtins.find((category) => category.name === '工资薪水')!.id);
  });
  it('退款保持退款语义，不变成普通收入；借贷类型不被支出识别覆盖', () => {
    expect(recognitionPreview(recognize('退款20元', []), draft, '', false, unprotected, state).type).toBe(
      'refund',
    );
    const preview = recognitionPreview(
      recognize('支出20元', []),
      { ...draft, type: 'repay' },
      '',
      false,
      unprotected,
      state,
    );
    expect(preview.type).toBe('repay');
    expect(preview.side).toBe('from');
  });
  it('交易金额缺失时不使用备注余额补齐，已有正数手填金额可保留', () => {
    const result = recognize('余额1,200元', []);
    expect(recognitionPreview(result, draft, '', false, unprotected, state).amount).toBeUndefined();
    expect(recognitionPreview(result, draft, '12.34', false, unprotected, state).amount).toBe(1234);
  });
  it.each(['', '0', '-1', '1.234'])('无效输入 %s 不作为有效采用金额', (text) => {
    expect(reviewAmount(text)).toBeUndefined();
  });
});

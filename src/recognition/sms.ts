import type { Account, Entity } from '../domain/model';
import { today, validTime } from '../domain/time';
import { recognizeAmounts, type AmountCandidate } from './amounts';
import { recognizePurpose } from './purposes';
export type Recognition = {
  type?: 'expense' | 'income' | 'refund';
  amount?: number;
  amountSource?: string;
  amountIndex?: number;
  amountCandidates: AmountCandidate[];
  balance?: number;
  accountIds: string[];
  categoryIds: string[];
  at?: string;
  rawDate: string;
  yearBasis: string;
  warnings: string[];
};
export function recognize(
  text: string,
  accounts: Entity<Account>[],
  now = new Date(),
  merchantRules: Record<string, string> = {},
): Recognition {
  const raw = text
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/−/g, '-');
  const result: Recognition = {
    amountCandidates: [],
    accountIds: [],
    categoryIds: [],
    rawDate: '',
    yearBasis: '',
    warnings: [],
  };
  const foreignCurrency =
    /美元|港币|港元|欧元|英镑|日元|日币|韩元|澳元|加元|新币|USD|HKD|EUR|GBP|JPY|KRW|AUD|CAD|SGD|[$€£]/i.test(
      raw,
    );
  const transferOrLoan = /转账|转入|转出|借入|借出|还款|还信用卡|收回借款/.test(raw);
  const unfinished =
    /(?:未|没|待|尚未)(?:付款|支付|扣款|到账|花)|(?:计划|预计|预算|打算).*(?:花|买|付)|(?:支付|退款|扣款)失败|免费|免单/.test(
      raw,
    );
  result.type = /退款|退货|冲正/.test(raw)
    ? 'refund'
    : transferOrLoan || unfinished
      ? undefined
      : /收入|入账|存入|到账|收到|收款/.test(raw)
        ? 'income'
        : /支出|消费|扣款|支付(?!宝)|付出|付款|花了|花费|买了/.test(raw)
          ? 'expense'
          : /工资|薪水|代发薪|奖金|年终奖|报销到账|收到补贴/.test(raw)
            ? 'income'
            : undefined;
  const purposes = recognizePurpose(raw, result.type).categoryIds;
  if (!result.type && purposes.length && !transferOrLoan && !unfinished) result.type = 'expense';
  const amounts = recognizeAmounts(
    raw,
    !!result.type || !!purposes.length || /^\s*[-+]?\d[\d,.]*\s*$/.test(raw),
  );
  Object.assign(result, amounts);
  if (foreignCurrency || unfinished) {
    result.amount = result.amountSource = undefined;
    result.amountIndex = undefined;
    result.amountCandidates = [];
  }
  if (foreignCurrency) result.balance = undefined;
  if (unfinished) result.warnings.push('这段备注可能是未完成的交易，请确认实际发生后再记账');
  if (transferOrLoan) result.warnings.push('可能是转账或借还，请核对记账类型及两端账户');
  const tail = raw.match(/(?:尾号|尾数|\*{2,})(\d{4})/)?.[1];
  const bank = raw.match(/【([^】]*银行)】/)?.[1];
  if (tail)
    result.accountIds = accounts
      .filter((a) => a.data.tail === tail && (!bank || a.data.bank === bank))
      .map((a) => a.id);
  if (result.accountIds.length !== 1)
    result.warnings.push(
      result.accountIds.length ? '尾号匹配多个账户，请选择' : '未匹配到资金账户，请核对已选账户或手动选择',
    );
  const date =
    raw.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/) ??
    raw.match(/(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (date) {
    result.rawDate = date[0];
    let year = Number(date[1] || today(now).slice(0, 4));
    const pad = (n: string) => n.padStart(2, '0');
    const suffix = `-${pad(date[2])}-${pad(date[3])}T${pad(date[4])}:${date[5]}:${date[6] || '00'}`;
    if (!date[1] && `${year}${suffix}`.slice(0, 10) > today(now)) {
      year--;
      result.yearBasis = 'previousYearCandidate';
    } else result.yearBasis = date[1] ? 'explicitText' : 'referenceDateCandidate';
    const candidate = `${year}${suffix}`;
    if (validTime(candidate)) result.at = candidate;
    else result.warnings.push('备注日期无效，请手动修正');
    if (!date[1]) result.warnings.push('年份为推断候选，请确认补账年份');
    if (result.at && result.at.slice(0, 10) > today(now)) result.warnings.push('备注时间晚于今天，请确认');
  } else result.warnings.push('缺少明确交易时间，保留草稿时间');
  // 只用原文唯一且有效的时间；多时刻、无效日期和当前补账时刻都不能用于推断餐次。
  const times = [...raw.matchAll(/(?<![\d:])(\d{1,2}):(\d{2})(?::(\d{2}))?(?![\d:])/g)];
  const time = times.length === 1 ? times[0] : undefined;
  const writtenTime =
    time &&
    Number(time[1]) < 24 &&
    Number(time[2]) < 60 &&
    Number(time[3] || '0') < 60 &&
    (!date || result.at)
      ? `${time[1].padStart(2, '0')}:${time[2]}`
      : undefined;
  for (const [merchant, category] of Object.entries(merchantRules))
    if (raw.includes(merchant)) result.categoryIds.push(category);
  if (!result.categoryIds.length) {
    // 同义词给候选，弱用途保留多个选项；支付渠道不能代表消费用途。
    const purpose = recognizePurpose(raw, result.type, writtenTime);
    result.categoryIds = purpose.categoryIds;
    if (result.categoryIds.length) result.warnings.push(purpose.basis || '分类按用途关键词推荐，请核对');
  }
  result.categoryIds = [...new Set(result.categoryIds)];
  if (foreignCurrency) result.warnings.push('当前仅支持人民币，备注包含其他币种，不会自动填入金额');
  if (!result.categoryIds.length) result.warnings.push('分类没有明确依据，请选择');
  if (result.type === 'refund') result.warnings.push('退款需选择原支出，不会计作普通收入');
  return result;
}

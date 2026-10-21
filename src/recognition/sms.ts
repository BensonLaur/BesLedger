import type { Account, Entity } from '../domain/model';
import { minor } from '../domain/money';
import { today, validTime } from '../domain/time';
export type Recognition = {
  type?: 'expense' | 'income' | 'refund';
  amount?: number;
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
  const raw = text.normalize('NFKC').replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '');
  const result: Recognition = { accountIds: [], categoryIds: [], rawDate: '', yearBasis: '', warnings: [] };
  result.type = /退款|退货|冲正/.test(raw)
    ? 'refund'
    : /支出|消费|扣款|支付|付出/.test(raw)
      ? 'expense'
      : /收入|入账|存入|到账|工资/.test(raw)
        ? 'income'
        : undefined;
  const balance = raw.match(/(?:可用)?余额(?:为|:|人民币|RMB|\s)*([\d,]+(?:\.\d{1,2})?)元?/i);
  if (balance) result.balance = minor(balance[1].replaceAll(',', ''));
  // 余额片段先剔除，绝不把短信里唯一的余额填成交易金额。
  const transactionPart = raw.split(/(?:可用)?余额/)[0];
  const amounts = [...transactionPart.matchAll(/([\d,]+(?:\.\d{1,2})?)\s*(?:元|人民币)/g)];
  if (result.type && amounts.length === 1) result.amount = minor(amounts[0][1].replaceAll(',', ''));
  else result.warnings.push(amounts.length > 1 ? '出现多个交易金额，请核对' : '未识别交易金额，请补填');
  const tail = raw.match(/(?:尾号|尾数|\*{2,})(\d{4})/)?.[1];
  const bank = raw.match(/【([^】]*银行)】/)?.[1];
  if (tail)
    result.accountIds = accounts
      .filter((a) => a.data.tail === tail && (!bank || a.data.bank === bank))
      .map((a) => a.id);
  if (result.accountIds.length !== 1)
    result.warnings.push(result.accountIds.length ? '尾号匹配多个账户，请选择' : '账户未匹配，请选择');
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
    else result.warnings.push('短信日期无效，请手动修正');
    if (!date[1]) result.warnings.push('年份为推断候选，请确认补账年份');
    if (result.at && result.at.slice(0, 10) > today(now)) result.warnings.push('短信时间晚于今天，请确认');
  } else result.warnings.push('缺少明确交易时间，保留草稿时间');
  for (const [merchant, category] of Object.entries(merchantRules))
    if (raw.includes(merchant)) result.categoryIds.push(category);
  if (!result.categoryIds.length) result.warnings.push('分类没有明确依据，请选择');
  if (result.type === 'refund') result.warnings.push('退款需选择原支出，不会计作普通收入');
  return result;
}

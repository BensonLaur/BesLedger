import { recognize, type Recognition } from '../recognition/sms';
import { categoryRulesFor } from '../recognition/text-category-rules';
import { categories } from './categories';
import { saveEntry } from './ledger';
import { list, type Entity, type Entry, type State } from './model';
import { decimal, minor } from './money';
import { localTime, validTime } from './time';

export type SmsMessage = { body: string; date?: number };
export type SmsDraft = {
  id: string;
  body: string;
  summary: string;
  recognition: Recognition;
  type?: 'expense' | 'income';
  at: string;
  confirmedAt: string;
  amount: string;
  accountId: string;
  categoryId: string;
  acceptedHistory: string;
  acceptedDuplicate: string;
};

const movement =
  /支出|消费|扣[款收]|实付|支付(?!宝)|收入|入账|存入|到账|转[入出账]|退款|冲正|还款成功|还款已完成/;
const nonTransaction =
  /验证码|动态口令|校验码|积分到账|支付失败|交易失败|扣款失败|(?:待|尚未|未能)(?:支付|扣款|还款|到账)|应还(?:款|本息|金额)|还款提醒|扣款提醒|请.{0,30}(?:及时还款|前还款|足额存入)|需.{0,30}前还款/;
const movementAmount = new RegExp(
  `(?:${movement.source})` +
    String.raw`(?:[:：]|金额|人民币|RMB|CNY|\([^)]*\))*(?:[¥￥]\d|\d[\d,.]*(?:元|人民币))`,
);

function compact(text: string): string {
  return text.normalize('NFKC').replace(/[\s\u200b-\u200d\ufeff]/g, '');
}

export function smsTime(at: string): string {
  return at.length === 16 ? `${at}:00` : at;
}

function smsAmount(input: string): number {
  try {
    return Math.max(minor(input), 0);
  } catch {
    return 0;
  }
}

async function sourceId(body: string, year: string): Promise<string> {
  // 来源原文只在会话中使用。稳定的散列 ID 让重试、备份与同步沿用同一笔账目身份。
  const input = new TextEncoder().encode(`${year}\n${body}`);
  const hash = await crypto.subtle.digest('SHA-256', input);
  return 'sms:' + Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function prepareSmsBatch(
  state: State,
  ledgerId: string,
  messages: SmsMessage[],
  now = new Date(),
) {
  const accounts = list(state, 'account').filter((account) => account.data.type !== 'receivable');
  const options = { categoryRules: categoryRulesFor(state, ledgerId) };
  const gathered = await Promise.all(
    messages.map(async (message): Promise<SmsDraft | undefined> => {
      const body = message.body.trim();
      const cleaned = compact(body);
      if (nonTransaction.test(cleaned) || !movement.test(cleaned)) return;
      const received = message.date ? new Date(message.date) : undefined;
      const receiptTime = received && received.valueOf() <= now.valueOf() ? received : undefined;
      const parseable = body.normalize('NFKC').replace(/\s*([年月日])\s*/g, '$1');
      const recognition = recognize(parseable, accounts, receiptTime ?? now, options);
      // 正向动账证据必须同时包含金额和银行交易特征，筛掉带有金额的普通通知。
      if (
        !movementAmount.test(cleaned) ||
        !(recognition.rawDate || /(?:尾号|尾数|\*{2,})\d{4}|\[[^\]]*银行\]|【[^】]*银行】/.test(cleaned)) ||
        recognition.warnings.some((warning) => warning.includes('未完成的交易'))
      )
        return;
      const type =
        recognition.type !== 'refund' && !recognition.warnings.some((warning) => warning.includes('其他币种'))
          ? recognition.type
          : undefined;
      const at = recognition.at ?? '';
      const writtenTime = Date.parse(`${at}+08:00`);
      // 收件时间只用来佐证年份。较迟收到、多个时间或未来日期仍要求核对。
      const nearbyReceipt = receiptTime && Math.abs(receiptTime.valueOf() - writtenTime) <= 24 * 3600000;
      const confirmedAt =
        at &&
        at <= localTime(now) &&
        !recognition.dateAmbiguous &&
        (recognition.yearBasis === 'explicitText' || nearbyReceipt)
          ? at
          : '';
      const clue = /(?:消费|支出|扣款|支付|收入|入账)\(([^)]{1,100})\)/.exec(cleaned)?.[1];
      return {
        id: await sourceId(cleaned, at.slice(0, 4)),
        body,
        summary: clue?.replace(/^(?:消费)?(?:财付通|支付宝)[-－]/, '') || '银行短信',
        recognition,
        type,
        at,
        confirmedAt,
        amount: recognition.amountCertain && recognition.amount ? decimal(recognition.amount) : '',
        accountId: recognition.accountIds.length === 1 ? recognition.accountIds[0] : '',
        categoryId:
          !recognition.categoryNeedsReview && recognition.categoryIds.length === 1
            ? recognition.categoryIds[0]
            : '',
        acceptedHistory: '',
        acceptedDuplicate: '',
      };
    }),
  );
  const unique = new Map<string, SmsDraft>();
  for (const row of gathered) if (row && !unique.has(row.id)) unique.set(row.id, row);
  return [...unique.values()].sort((a, b) => b.at.localeCompare(a.at));
}

function transactionKey(type: string, at: string, amount: number, account: string): string {
  return JSON.stringify([type, at.slice(0, 16), amount, account]);
}

export function smsReviewContext(state: State, ledgerId: string, now = new Date(), rows: SmsDraft[] = []) {
  const byNote = new Map<string, Entity<Entry>[]>();
  const byTransaction = new Map<string, Entity<Entry>[]>();
  for (const entity of Object.values(state.entities)) {
    if (entity.data.kind !== 'entry') continue;
    const entry = entity as Entity<Entry>;
    const data = entry.data;
    if (data.note && movement.test(data.note)) {
      const note = compact(data.note);
      byNote.set(note, [...(byNote.get(note) ?? []), entry]);
    }
    if (entry.deleted || !['expense', 'income'].includes(data.type)) continue;
    const key = transactionKey(data.type, data.at, data.amount, data.from || data.to);
    byTransaction.set(key, [...(byTransaction.get(key) ?? []), entry]);
  }
  const earlierRows = new Map<string, SmsDraft>();
  const firstByTransaction = new Map<string, SmsDraft>();
  for (const row of rows) {
    const amount = smsAmount(row.amount);
    if (!row.type || !row.accountId || !row.at || !amount) continue;
    const key = transactionKey(row.type, row.at, amount, row.accountId);
    const earlier = firstByTransaction.get(key);
    if (earlier && earlier.id !== row.id) earlierRows.set(row.id, earlier);
    else firstByTransaction.set(key, row);
  }
  return {
    state,
    ledgerId,
    latest: localTime(now),
    categoryTypes: new Map(categories(state, ledgerId).map(({ id, type }) => [id, type])),
    byNote,
    byTransaction,
    earlierRows,
  };
}

export function reviewSmsDraft(row: SmsDraft, context: ReturnType<typeof smsReviewContext>) {
  const exact = context.state.entities[row.id] as Entity<Entry> | undefined;
  const pasted = context.byNote
    .get(compact(row.body))
    ?.find((entry) => !row.recognition.at || entry.data.at.slice(0, 4) === row.recognition.at.slice(0, 4));
  const existing = exact ?? pasted;
  const amount = smsAmount(row.amount);
  const at = smsTime(row.at);
  const account = context.state.entities[row.accountId];
  const accountData = account?.data;
  const hasAccount = accountData?.kind === 'account' && !account.deleted && accountData.type !== 'receivable';
  const validDate = validTime(at) && at <= context.latest;
  const historyKey =
    hasAccount && validDate && at < accountData.openedAt
      ? JSON.stringify([row.accountId, at, accountData.openedAt])
      : '';
  const key = transactionKey(row.type ?? '', at, amount, row.accountId);
  const duplicates = context.byTransaction.get(key) ?? [];
  const earlierRow = context.earlierRows.get(row.id);
  // 同批确认对应交易字段；取消勾选其中一笔时，其余短信的确认仍有效。
  const duplicateKey =
    duplicates.length || earlierRow ? JSON.stringify([key, ...duplicates.map(({ id }) => id).sort()]) : '';
  let issue = '';
  if (!existing) {
    if (!row.type) issue = '需要逐笔处理';
    else if (!amount) issue = '核对金额';
    else if (!validDate || at !== row.confirmedAt) issue = '核对发生时间';
    else if (!hasAccount) issue = '选择账户';
    else if (context.categoryTypes.get(row.categoryId) !== row.type) issue = '选择分类';
    else if (historyKey && historyKey !== row.acceptedHistory) issue = '早于账户起算时间';
    else if (duplicateKey && duplicateKey !== row.acceptedDuplicate) issue = '疑似重复';
  }
  return { existing, issue, amount, at, historyKey, duplicates, earlierRow, duplicateKey, validDate };
}

export function saveSmsBatch(state: State, ledgerId: string, rows: SmsDraft[], now = new Date()) {
  const ledger = state.entities[ledgerId];
  if (ledger?.deleted || ledger?.data.kind !== 'ledger') throw new Error('请先选择有效账本');
  const context = smsReviewContext(state, ledgerId, now, rows);
  const pending = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const review = reviewSmsDraft(row, context);
    if (review.existing) continue;
    // 按提交时的账本重新检查，新增的冲突不沿用之前的确认。
    if (!row.type || review.issue) throw new Error(`请重新核对本批交易（${review.issue}）`);
    pending.push({
      id: row.id,
      data: {
        kind: 'entry' as const,
        ledgerId,
        type: row.type,
        amount: review.amount,
        interest: 0,
        from: row.type === 'expense' ? row.accountId : '',
        to: row.type === 'income' ? row.accountId : '',
        categoryId: row.categoryId,
        at: review.at,
        note: row.summary,
        behavior: '转账',
        createdAt: context.latest,
      },
    });
  }
  for (const { id, data } of pending) saveEntry(state, data, id, false);
  return pending.length;
}

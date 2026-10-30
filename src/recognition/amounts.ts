export type AmountCandidate = { amount: number; text: string };
type Token = AmountCandidate & { start: number; end: number; role: 'value' | 'total' | 'other' | 'balance' };
const digits = '零〇一二两三四五六七八九壹贰叁肆伍陆柒捌玖';
const chinese = `${digits}十百千万亿拾佰仟萬億`;
const number = `[-+负]?(?:\\d(?:[\\d,.]*\\d)?(?:[千万亿])?|\\.\\d+|[${chinese}]+(?:点[${digits}]+)?)`;
const yuan = '(?:元|块钱?|圆|人民币|RMB|CNY)';
const quantity = '(?:人|个|份|次|天|小时|分钟|公里|斤|克|瓶|升|号|点|折|%|岁|张|月|年|km\\b|kg\\b)';
const fraction = `(?:\\s*[${digits}0-9]\\s*[角毛](?:\\s*[${digits}0-9]\\s*分(?!钟))?|\\s*[${digits}0-9]{1,2}\\s*分(?!钟)|\\s*[${digits}0-9](?=$|[，。!！;；、\\s])(?!\\s*${quantity}))?`;
const tokenPattern = new RegExp(
  `(?<![${chinese}\\d.,a-zA-Z负+\\-/])(?:(?:人民币|RMB|CNY|¥)\\s*${number}(?:\\s*${yuan}${fraction})?|${number}\\s*${yuan}${fraction}|${number}\\s*(?:角|毛)(?:\\s*[${digits}0-9]\\s*分)?|${number}\\s*分钱?)`,
  'gi',
);
const digitValues: Record<string, number> = {};
for (const [chars, value] of [
  '零〇',
  '一壹',
  '二两贰',
  '三叁',
  '四肆',
  '五伍',
  '六陆',
  '七柒',
  '八捌',
  '九玖',
].map((chars, value) => [chars, value] as const))
  for (const char of chars) digitValues[char] = value;
const units: Record<string, bigint> = { 十: 10n, 拾: 10n, 百: 100n, 佰: 100n, 千: 1000n, 仟: 1000n };

function chineseInteger(text: string): bigint {
  if (!text || !new RegExp(`^[${chinese}]+$`).test(text)) throw new Error('invalid');
  for (const [symbols, scale] of [
    ['亿億', 100000000n],
    ['万萬', 10000n],
  ] as const) {
    const parts = text.split(new RegExp(`[${symbols}]`));
    if (parts.length > 2) throw new Error('invalid');
    if (parts.length === 2)
      return chineseInteger(parts[0]) * scale + (parts[1] ? chineseInteger(parts[1]) : 0n);
  }
  if ([...text].every((c) => c in digitValues)) return BigInt([...text].map((c) => digitValues[c]).join(''));
  let total = 0n,
    digit: number | undefined,
    lastUnit = 10000n;
  for (const char of text) {
    if (char in digitValues) {
      if (digit !== undefined && digit !== 0) throw new Error('invalid');
      digit = digitValues[char];
    } else {
      const unit = units[char];
      if (!unit || unit >= lastUnit || (digit === undefined && unit !== 10n)) throw new Error('invalid');
      total += BigInt(digit ?? 1) * unit;
      digit = undefined;
      lastUnit = unit;
    }
  }
  // “一百二”“三千五”有多种口语含义，只接受显式的“零”或完整单位。
  if (digit && lastUnit >= 100n && !/[零〇][^十百千拾佰仟]*$/.test(text)) throw new Error('ambiguous');
  return total + BigInt(digit ?? 0);
}
function cents(text: string): bigint {
  if (/[.点]$/.test(text) || text.split(/[.点]/).length > 2) throw new Error('invalid');
  let scale = 1n;
  if (/\d[千万亿]$/.test(text)) {
    scale = { 千: 1000n, 万: 10000n, 亿: 100000000n }[text.at(-1)!]!;
    text = text.slice(0, -1);
  }
  if (text.startsWith('-') || text.startsWith('负')) throw new Error('negative');
  text = text.replace(/^\+/, '');
  const [whole, fraction = ''] = text.split(/[.点]/);
  let integer: bigint, decimals: string;
  if (/[零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟萬億]/.test(whole)) {
    integer = chineseInteger(whole);
    decimals = [...fraction]
      .map((c) => {
        if (!(c in digitValues)) throw new Error('invalid');
        return digitValues[c];
      })
      .join('');
  } else {
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)?$/.test(whole) || !/^\d*$/.test(fraction)) throw new Error('invalid');
    if (text.split('.').length > 2) throw new Error('invalid');
    integer = BigInt(whole.replaceAll(',', '') || '0');
    decimals = fraction;
  }
  if (scale === 1n && decimals.length > 2) throw new Error('precision');
  const denominator = 10n ** BigInt(decimals.length);
  const numerator = (integer * denominator + BigInt(decimals || '0')) * 100n * scale;
  if (numerator % denominator) throw new Error('precision');
  return numerator / denominator;
}
function tokenCents(text: string, allowZero = false): number {
  const clean = text.replace(/^(?:人民币|RMB|CNY|¥)\s*/i, '').replaceAll(/\s/g, '');
  const parts = clean.match(/^(.*?)(元|块钱?|圆|人民币|RMB|CNY)(.*)$/i);
  let value: bigint;
  if (parts) {
    value = cents(parts[1]);
    const fraction = parts[3];
    if (fraction) {
      const f = fraction.match(/^(.)(?:角|毛)(?:(.)分)?$/);
      if (f) value += (cents(f[1]) / 100n) * 10n + (f[2] ? cents(f[2]) / 100n : 0n);
      else if (fraction.endsWith('分')) value += cents(fraction.slice(0, -1)) / 100n;
      else value += (cents(fraction) / 100n) * 10n;
    }
  } else if (/^(.*?)[角毛](?:(.)分)?$/.test(clean)) {
    const coin = clean.match(/^(.*?)[角毛](?:(.)分)?$/)!;
    const major = cents(coin[1]);
    if (major % 10n) throw new Error('precision');
    value = major / 10n + (coin[2] ? cents(coin[2]) / 100n : 0n);
  } else if (/分钱?$/.test(clean)) {
    const coin = cents(clean.replace(/分钱?$/, ''));
    if (coin % 100n) throw new Error('precision');
    value = coin / 100n;
  } else value = cents(clean);
  if (value < 0n || (!allowZero && value === 0n) || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('range');
  return Number(value);
}
function role(text: string, start: number, end: number): Token['role'] {
  // 只检查金额附近的标签，不截掉“余额在前、实际付款在后”的整段文字。
  const prefix = text
    .slice(Math.max(0, start - 18), start)
    .split(/[，,。;；\n]/)
    .at(-1)!;
  const suffix = text.slice(end);
  if (/(?:余额|结余|还剩|剩余金额)(?:为|是|:|人民币|RMB|CNY|\s)*$/i.test(prefix)) return 'balance';
  if (
    /(?:原价|单价|优惠|优惠券|立减|满减|折扣|找零|找回|预算|预计|预估|额度|限额|定价|标价|押金退回前)(?:金额|了|为|是|:|\s)*$/.test(
      prefix,
    )
  )
    return 'other';
  if (/^\s*(?:\/|每|一)(?:小时|分钟|天|次|人|斤|公斤|杯|个|份|件|月|年)/.test(suffix)) return 'other';
  if (
    /(?:实付|实收|实扣|实际支付|实际付款|实际扣款|实际到账|合计|总计|共计|总共|一共|共花)(?:金额|了|为|是|:|\s)*$/.test(
      prefix,
    )
  )
    return 'total';
  return 'value';
}
export function recognizeAmounts(text: string, allowBare: boolean) {
  const tokens: Token[] = [],
    warnings: string[] = [];
  let invalid = false;
  for (const match of text.matchAll(tokenPattern)) {
    const start = match.index!,
      end = start + match[0].length;
    // 不从小数、指数、编号或外币数字的中间截一段金额；“9点10分”也不是零钱。
    if (/分$/.test(match[0]) && (/^钟/.test(text.slice(end)) || /\d[点时]$/.test(text.slice(0, start))))
      continue;
    const tokenRole = role(text, start, end);
    const remainder = text.slice(end);
    if (
      /^[:/]\d/.test(remainder) ||
      (new RegExp(`^[${digits}0-9]`).test(remainder) &&
        !new RegExp(`^[${digits}0-9]+\\s*${quantity}`, 'i').test(remainder))
    ) {
      invalid = true;
      continue;
    }
    try {
      tokens.push({
        amount: tokenCents(match[0], tokenRole === 'balance'),
        text: match[0],
        start,
        end,
        role: tokenRole,
      });
    } catch {
      if (tokenRole !== 'balance' && tokenRole !== 'other') invalid = true;
    }
  }
  const balances = tokens.filter((t) => t.role === 'balance');
  // 银行通知也可能省略余额后的“元”；仅提取作核对，不参加交易候选。
  if (!balances.length) {
    for (const match of text.matchAll(/(?:可用)?余额(?:为|是|:|\s)*([\d,]+(?:\.\d+)?)(?![\d.])/g)) {
      try {
        balances.push({
          amount: tokenCents(match[1], true),
          text: match[0],
          start: match.index!,
          end: match.index! + match[0].length,
          role: 'balance',
        });
      } catch {
        /* 无效余额不影响可确认的交易金额。 */
      }
    }
  }
  let candidates = tokens.filter((t) => t.role === 'value' || t.role === 'total');
  let inferredUnit = false;
  const hasExplicit = candidates.length > 0 || invalid;
  if (!hasExplicit && allowBare) {
    // 有单位的余额/优惠不能挡住旁边无单位的交易金额，也不能再次参与候选。
    let remainder = text;
    for (const token of [...tokens].reverse())
      remainder =
        remainder.slice(0, token.start) + ' '.repeat(token.end - token.start) + remainder.slice(token.end);
    const masked = remainder
      .replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}|(?:\d{4}年)?\d{1,2}月\d{1,2}日|\d{1,2}:\d{2}(?::\d{2})?/g, ' ')
      .replace(
        /(?:尾号|尾数|卡号|订单号?|单号|编号|号码|流水号|手机号|电话)\s*[:：]?\s*\d+|\b1\d{10}\b/g,
        ' ',
      );
    if (/\d\s*[+*/×÷-]\s*\d/.test(masked)) invalid = true;
    for (const match of masked.matchAll(/[-+]?\d(?:[\d,.]*\d)?/g)) {
      const start = match.index!,
        end = start + match[0].length;
      if (/^[.,](?:元|块|圆|人民币)/.test(masked.slice(end))) {
        invalid = true;
        continue;
      }
      if (
        /[\da-zA-Z./:-]/.test(masked[start - 1] || '') ||
        /^[a-zA-Z/:]/.test(masked.slice(end)) ||
        /^\s*(?:人|个|份|次|天|小时|分钟|公里|斤|克|瓶|升|号|点|折|%|岁|张|月|年|km\b|kg\b)/i.test(
          masked.slice(end),
        )
      )
        continue;
      try {
        candidates.push({
          amount: tokenCents(match[0]),
          text: match[0],
          start,
          end,
          role: role(masked, start, end),
        });
      } catch {
        invalid = true;
      }
    }
    candidates = candidates.filter((t) => t.role === 'value' || t.role === 'total');
    if (candidates.length) warnings.push('金额未写单位，按元识别，请核对');
    inferredUnit = candidates.length > 0;
  }
  const totals = candidates.filter((t) => t.role === 'total');
  const selected = totals.length === 1 ? totals[0] : candidates.length === 1 ? candidates[0] : undefined;
  if (invalid) warnings.push('有金额格式、精度或正负号不明确，请手动核对');
  if (!selected)
    warnings.push(
      candidates.length > 1 ? '出现多个交易金额，请选择本次实际金额，不会自动相加' : '未识别交易金额，请补填',
    );
  return {
    amount: invalid ? undefined : selected?.amount,
    amountCertain: !invalid && !!selected && !inferredUnit,
    amountSource: invalid ? undefined : selected?.text,
    amountIndex: invalid || !selected ? undefined : candidates.indexOf(selected),
    amountCandidates: candidates.map(({ amount, text }) => ({ amount, text })),
    balance: balances.length === 1 ? balances[0].amount : undefined,
    warnings,
  };
}

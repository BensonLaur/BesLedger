export function minor(input: string): number {
  const text = input.trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) throw new Error('请输入最多两位小数的金额');
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  const value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('金额超出安全范围');
  return Number(negative ? -value : value);
}
export function sum(values: number[]): number {
  const result = values.reduce((a, b) => a + BigInt(b), 0n);
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER))
    throw new Error('合计超出安全范围');
  return Number(result);
}
export function money(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error('无效整数金额');
  const n = Math.abs(value);
  return `${value < 0 ? '-' : ''}${Math.trunc(n / 100).toLocaleString('zh-CN')}.${String(n % 100).padStart(2, '0')}`;
}
export function decimal(value: number): string {
  return money(value).replaceAll(',', '');
}

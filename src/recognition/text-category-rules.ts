import type { TextCategoryRule } from '../domain/model';

export type CategoryRule = TextCategoryRule & { type: 'expense' | 'income' };
// 只存为规则目标，识别后解析为实际账目分类。
export const autoThreeMealsRuleTarget = {
  id: 'rule:three-meals',
  name: '三餐*自动',
  group: '餐饮',
  type: 'expense',
} as const;

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .toLowerCase();
}

function parts(pattern: string): string[] {
  return normalize(pattern)
    .split('*')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function validCategoryPattern(pattern: string): boolean {
  return pattern.trim().length <= 120 && parts(pattern).length > 0;
}

/** 用字面量逐段查找，* 可以跨任意文字（含空串），备注首尾也可以有其他文字。 */
export function firstCategoryRule(
  note: string,
  type: 'expense' | 'income',
  rules: readonly CategoryRule[],
): CategoryRule | undefined {
  const text = normalize(note);
  return rules.find((rule) => {
    if (rule.type !== type) return false;
    const fragments = parts(rule.pattern);
    if (!fragments.length) return false;
    let offset = 0;
    for (const fragment of fragments) {
      const index = text.indexOf(fragment, offset);
      if (index < 0) return false;
      offset = index + fragment.length;
    }
    return true;
  });
}

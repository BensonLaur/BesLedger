import { type State } from '../domain/model';
import { validateState } from '../domain/ledger';
import { mergeEntities, resolveConflict, validateProjection } from './merge';

export function applySyncReview(state: State, ledgerId: string, currentDigest: string): void {
  const review = state.syncReviews?.[ledgerId];
  if (!review) throw new Error('没有待核对的内容，请重新同步');
  if (review.baseDigest !== currentDigest)
    throw new Error('这里的账目已有变化，请重新同步后核对，之前的选择未覆盖账目');
  if (review.conflicts.some((c) => !review.choices[c.id])) throw new Error('请为每一项选择要保留的内容');
  validateProjection(review.remote, ledgerId);
  const merged = mergeEntities(state.entities, review.remote);
  // 一次性采用完整合并并校验，避免逐条选择导致退款或共用账户暂时缺少引用。
  const alreadyHere = !!state.entities[ledgerId];
  state.entities = merged.entities;
  for (const conflict of merged.conflicts) {
    const choice = review.choices[conflict.id];
    if (!choice) throw new Error('差异已有变化，请重新同步后核对');
    resolveConflict(state, conflict, choice);
  }
  const ledger = state.entities[ledgerId];
  if (ledger && !ledger.deleted && (!alreadyHere || !state.preferences.currentLedger))
    state.preferences.currentLedger = ledgerId;
  if (state.entities[state.preferences.currentLedger]?.deleted)
    state.preferences.currentLedger =
      Object.values(state.entities).find((e) => e.data.kind === 'ledger' && !e.deleted)?.id || '';
  if (state.bindings[ledgerId]) state.bindings[ledgerId].syncedDigest = undefined;
  delete state.syncReviews![ledgerId];
  validateState(state);
}

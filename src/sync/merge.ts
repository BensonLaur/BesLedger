import { canonical } from '../crypto/vault';
import { entitySchema, type Entity, type State } from '../domain/model';
import { validateState } from '../domain/ledger';
export type Conflict = { id: string; local: Entity; remote: Entity; reason: string; related?: Entity[] };
export function dominates(a: Entity['clock'], b: Entity['clock']): boolean {
  return Object.entries(b).every(([device, revision]) => (a[device] ?? 0) >= revision);
}
function sameContent(a: Entity, b: Entity): boolean {
  const normalize = (e: Entity) => {
    const data = structuredClone(e.data);
    if (data.kind === 'entry' && data.source && !data.manualCategoryAt) data.createdAt = data.at;
    if (data.kind === 'rule') data.cursor = data.start;
    return { data, deleted: e.deleted };
  };
  return canonical(normalize(a)) === canonical(normalize(b));
}
export function mergedClock(a: Entity, b: Entity): Entity['clock'] {
  return Object.fromEntries(
    [...new Set([...Object.keys(a.clock), ...Object.keys(b.clock)])].map((key) => [
      key,
      Math.max(a.clock[key] ?? 0, b.clock[key] ?? 0),
    ]),
  );
}
export function mergeEntities(
  local: Record<string, Entity>,
  remote: Record<string, Entity>,
): { entities: Record<string, Entity>; conflicts: Conflict[] } {
  const entities = structuredClone(local),
    conflicts: Conflict[] = [];
  for (const [id, input] of Object.entries(remote)) {
    const incoming = entitySchema.parse(input);
    if (incoming.id !== id) throw new Error('远端记录身份不一致');
    const current = entities[id];
    if (!current) {
      entities[id] = incoming;
      continue;
    }
    const localAhead = dominates(current.clock, incoming.clock),
      remoteAhead = dominates(incoming.clock, current.clock);
    if (sameContent(current, incoming)) {
      const combined = structuredClone(current);
      combined.clock = mergedClock(current, incoming);
      if (combined.data.kind === 'entry' && incoming.data.kind === 'entry' && combined.data.source) {
        // 两端独立补生成同一期次时，取最早的真实创建时刻，避免相同业务反复互相改写。
        combined.data.createdAt = [combined.data.createdAt, incoming.data.createdAt].sort()[0];
      }
      if (combined.data.kind === 'rule' && incoming.data.kind === 'rule')
        combined.data.cursor = [combined.data.cursor, incoming.data.cursor].sort().at(-1)!;
      entities[id] = combined;
    } else if (remoteAhead && !localAhead) entities[id] = incoming;
    else if (!localAhead || remoteAhead)
      conflicts.push({
        id,
        local: current,
        remote: incoming,
        reason: current.deleted !== incoming.deleted ? '删除与编辑并发' : '同一记录两端均有修改',
      });
  }
  for (const ledger of Object.values(entities).filter((e) => e.data.kind === 'ledger' && e.deleted)) {
    const related = Object.values(entities).filter(
      (e) => 'ledgerId' in e.data && e.data.ledgerId === ledger.id,
    );
    const pending = related.filter((e) => !e.deleted);
    if (
      pending.length &&
      local[ledger.id] &&
      remote[ledger.id] &&
      !conflicts.some((c) => c.id === ledger.id)
    ) {
      conflicts.unshift({
        id: ledger.id,
        local: local[ledger.id],
        remote: remote[ledger.id],
        related,
        reason: `账本删除与 ${pending.length} 条未同步记录并发；选择删除会一并删除这些记录`,
      });
    }
  }
  return { entities, conflicts };
}
export function resolveConflict(state: State, conflict: Conflict, choice: 'local' | 'remote'): void {
  const selected = choice === 'local' ? conflict.local : conflict.remote;
  const clock = mergedClock(conflict.local, conflict.remote);
  clock[state.deviceId] = (clock[state.deviceId] ?? 0) + 1;
  state.entities[conflict.id] = { ...structuredClone(selected), clock };
  if (selected.data.kind === 'ledger' && selected.deleted && conflict.related) {
    for (const entity of conflict.related) {
      const local = state.entities[entity.id];
      const nextClock = local ? mergedClock(local, entity) : { ...entity.clock };
      nextClock[state.deviceId] = (nextClock[state.deviceId] ?? 0) + 1;
      state.entities[entity.id] = { ...structuredClone(entity), clock: nextClock, deleted: true };
    }
  }
}
export function ledgerProjection(state: State, ledgerId: string): Record<string, Entity> {
  const result: Record<string, Entity> = {};
  const references = new Set<string>();
  for (const e of Object.values(state.entities)) {
    if (e.id === ledgerId || ('ledgerId' in e.data && e.data.ledgerId === ledgerId)) {
      result[e.id] = e;
      const entry = e.data.kind === 'entry' ? e.data : e.data.kind === 'rule' ? e.data.template : undefined;
      if (entry) {
        if (entry.from) references.add(entry.from);
        if (entry.to) references.add(entry.to);
      }
    }
  }
  for (const account of references) {
    const entity = state.entities[account];
    if (entity?.data.kind === 'account') result[account] = entity;
  }
  return structuredClone(result);
}
export function validateProjection(entities: Record<string, Entity>, ledgerId: string): void {
  const ledger = entities[ledgerId];
  if (!ledger || ledger.data.kind !== 'ledger') throw new Error('远端缺少账本定义');
  for (const e of Object.values(entities)) {
    if (e.data.kind === 'ledger' && e.id !== ledgerId) throw new Error('远端包含其他账本');
    if ('ledgerId' in e.data && e.data.ledgerId !== ledgerId) throw new Error('远端数据超出当前账本范围');
  }
  if (!ledger.deleted)
    validateState({
      schemaVersion: 2,
      deviceId: 'validation',
      entities,
      bindings: {},
      preferences: { currentLedger: ledgerId, quick: {} },
    });
}
export function mainStatus(local: boolean, remote: boolean, dirty: boolean, conflicts = false): string {
  if (!local) return remote ? '仅云端' : '不可用';
  if (!remote) return '仅本地';
  return dirty || conflicts ? '待同步' : '已同步';
}

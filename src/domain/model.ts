import { z } from 'zod';
import { validTime } from './time';

const id = z.string().min(1).max(180);
const amount = z.number().refine(Number.isSafeInteger, '金额必须为安全整数分');
const instant = z.string().refine(validTime, '无效日期时间');
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => validTime(`${v}T12:00:00`));
const title = z.string().trim().min(1).max(100);
export const ledgerSchema = z.object({ kind: z.literal('ledger'), name: title });
export const accountSchema = z.object({
  kind: z.literal('account'),
  name: title,
  type: z.enum(['cash', 'bank', 'wallet', 'credit', 'receivable', 'asset', 'liability']),
  // 只补充展示分类；旧账本缺省时仍按原账户类型解释余额与流水。
  displayType: z
    .enum(['cash', 'credit', 'bank', 'wallet', 'investment', 'receivable', 'stored', 'other'])
    .optional(),
  opening: amount,
  openedAt: instant,
  bank: z.string().max(100).default(''),
  tail: z.string().max(4).default(''),
  repaymentDay: z.number().int().min(1).max(31).optional(),
});
export const entrySchema = z.object({
  kind: z.literal('entry'),
  ledgerId: id,
  type: z.enum(['expense', 'income', 'transfer', 'borrow', 'lend', 'repay', 'collect', 'refund']),
  amount: amount.refine((v) => v > 0, '金额必须大于零'),
  interest: amount.refine((v) => v >= 0).default(0),
  from: z.string().default(''),
  to: z.string().default(''),
  categoryId: z.string().default(''),
  at: instant,
  note: z.string().max(20000).default(''),
  behavior: z.string().max(30).default('转账'),
  originalId: z.string().optional(),
  due: day.optional(),
  settlesId: z.string().optional(),
  source: z.object({ ruleId: id, occurrence: day }).optional(),
  recognition: z
    .object({
      rawDate: z.string(),
      yearBasis: z.string(),
      confirmed: z.boolean(),
      balance: amount.optional(),
    })
    .optional(),
  manualCategoryAt: instant.optional(),
  createdAt: instant,
});
export const categorySchema = z.object({
  kind: z.literal('category'),
  ledgerId: id,
  name: title,
  group: title,
  type: z.enum(['expense', 'income']),
  icon: z.string(),
});
export const budgetSchema = z.object({
  kind: z.literal('budget'),
  ledgerId: id,
  month: z.string().regex(/^\d{4}-\d{2}$/),
  enabled: z.boolean(),
  amount: amount.refine((v) => v > 0),
});
export const ruleSchema = z.object({
  kind: z.literal('rule'),
  ledgerId: id,
  name: title,
  start: day,
  end: day.optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  paused: z.boolean(),
  cursor: day,
  time: z.string().regex(/^\d{2}:\d{2}$/),
  template: entrySchema,
});
export const dataSchema = z.discriminatedUnion('kind', [
  ledgerSchema,
  accountSchema,
  entrySchema,
  categorySchema,
  budgetSchema,
  ruleSchema,
]);
export type Data = z.infer<typeof dataSchema>;
export type Account = z.infer<typeof accountSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type Category = z.infer<typeof categorySchema>;
export const entitySchema = z.object({
  id,
  clock: z.record(id, z.number().int().nonnegative()),
  deleted: z.boolean(),
  data: dataSchema,
});
export type Entity<T extends Data = Data> = Omit<z.infer<typeof entitySchema>, 'data'> & { data: T };
export const bindingSchema = z.object({
  owner: id,
  repo: id,
  userId: z.number().int(),
  remoteHash: z.string().optional(),
  lastChecked: z.string().optional(),
  syncedDigest: z.string().optional(),
  remoteExists: z.boolean().default(false),
});
export type Binding = z.infer<typeof bindingSchema>;
export const stateSchema = z.object({
  schemaVersion: z.literal(2),
  deviceId: id,
  entities: z.record(id, entitySchema),
  bindings: z.record(id, bindingSchema),
  preferences: z.object({ currentLedger: z.string(), quick: z.record(z.string(), z.array(z.string())) }),
});
export type State = z.infer<typeof stateSchema>;
export function emptyState(): State {
  return {
    schemaVersion: 2,
    deviceId: crypto.randomUUID(),
    entities: {},
    bindings: {},
    preferences: { currentLedger: '', quick: {} },
  };
}
export function list<K extends Data['kind']>(state: State, kind: K): Entity<Extract<Data, { kind: K }>>[] {
  return Object.values(state.entities).filter((e) => !e.deleted && e.data.kind === kind) as Entity<
    Extract<Data, { kind: K }>
  >[];
}
export function put(
  state: State,
  data: Data,
  entityId: string = crypto.randomUUID(),
  deleted = false,
): Entity {
  const old = state.entities[entityId];
  const clock = { ...old?.clock, [state.deviceId]: (old?.clock[state.deviceId] ?? 0) + 1 };
  const entity = entitySchema.parse({ id: entityId, clock, data, deleted });
  state.entities[entityId] = entity;
  return entity;
}
export function tombstone(state: State, entityId: string): void {
  const old = state.entities[entityId];
  if (!old) throw new Error('记录不存在');
  put(state, old.data, entityId, true);
}

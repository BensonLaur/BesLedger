import { decrypt, digest, encrypt } from '../crypto/vault';
import { type Binding, type Entity, type State } from '../domain/model';
import { GitHub, GitHubError } from '../providers/github/client';
import { ledgerProjection, mergeEntities, validateProjection, type Conflict } from './merge';
import { z } from 'zod';
import { entitySchema } from '../domain/model';
const payloadSchema = z.object({
  format: z.literal('BesLedger.ledger'),
  version: z.literal(1),
  ledgerId: z.string(),
  entities: z.record(z.string(), entitySchema),
});
export type SyncResult = {
  entities: Record<string, Entity>;
  conflicts: Conflict[];
  binding: Binding;
  localDigest: string;
};
export async function syncLedger(
  state: State,
  ledgerId: string,
  binding: Binding,
  key: CryptoKey,
  github: GitHub,
): Promise<SyncResult> {
  const user = await github.user();
  if (user.id !== binding.userId) throw new Error('登录账号与账本绑定不同，已停止同步');
  const local = ledgerProjection(state, ledgerId);
  validateProjection(local, ledgerId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const file = await github.readLedger(binding.owner, binding.repo, ledgerId, user.id);
    if (!file && binding.remoteExists)
      throw new Error('原远端账本不可见，请检查删除或权限；不会自动重新上传');
    let remote: Record<string, Entity> = {};
    if (file) {
      const parsed = payloadSchema.parse(await decrypt(JSON.parse(file.text), key, `ledger:${ledgerId}`));
      if (parsed.ledgerId !== ledgerId) throw new Error('解密账本身份不匹配');
      remote = parsed.entities;
      validateProjection(remote, ledgerId);
    }
    const merged = mergeEntities(local, remote);
    const localDigest = await digest(local);
    if (merged.conflicts.length)
      return { ...merged, binding: { ...binding, remoteExists: !!file, remoteHash: file?.sha }, localDigest };
    // 独立退款合并可能超出原单，先校验业务约束，再允许发布完整密文。
    validateProjection(merged.entities, ledgerId);
    const mergedDigest = await digest(merged.entities);
    let sha = file?.sha;
    if (!file || mergedDigest !== (await digest(remote))) {
      const encrypted = await encrypt(
        { format: 'BesLedger.ledger', version: 1, ledgerId, entities: merged.entities },
        key,
        `ledger:${ledgerId}`,
      );
      try {
        sha = await github.writeLedger(
          binding.owner,
          binding.repo,
          ledgerId,
          user.id,
          JSON.stringify(encrypted),
          file?.sha,
        );
      } catch (error) {
        if (error instanceof GitHubError && [409, 422].includes(error.status) && attempt < 2) continue;
        throw error;
      }
    }
    return {
      ...merged,
      binding: {
        ...binding,
        remoteExists: true,
        remoteHash: sha,
        syncedDigest: mergedDigest,
        lastChecked: new Date().toISOString(),
      },
      localDigest,
    };
  }
  throw new Error('远端持续更新，请稍后重试');
}
export async function downloadLedger(
  ledgerId: string,
  binding: Binding,
  key: CryptoKey,
  github: GitHub,
): Promise<Record<string, Entity>> {
  if ((await github.user()).id !== binding.userId) throw new Error('GitHub 账号不匹配');
  const file = await github.readLedger(binding.owner, binding.repo, ledgerId, binding.userId);
  if (!file) throw new Error('远端账本不可访问');
  const payload = payloadSchema.parse(await decrypt(JSON.parse(file.text), key, `ledger:${ledgerId}`));
  if (payload.ledgerId !== ledgerId) throw new Error('账本身份不匹配');
  validateProjection(payload.entities, ledgerId);
  return payload.entities;
}

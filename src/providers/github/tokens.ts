import { z } from 'zod';

const token = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9_.-]+$/);
export const tokensSchema = z.object({
  accessToken: token,
  refreshToken: token.optional(),
  expiresAt: z.number().finite().optional(),
  refreshExpiresAt: z.number().finite().optional(),
});
export type AuthTokens = z.infer<typeof tokensSchema>;
export class AuthorizationInvalid extends Error {
  constructor() {
    super('GitHub 授权已失效，请重新登录');
  }
}
const replySchema = z.object({
  access_token: token,
  refresh_token: token.optional(),
  expires_in: z.number().nonnegative().finite().optional(),
  refresh_token_expires_in: z.number().nonnegative().finite().optional(),
  scope: z.string(),
});
export function parseTokenReply(value: unknown, now = Date.now()): AuthTokens {
  const result = replySchema.safeParse(value);
  if (!result.success) throw new Error('GitHub 授权响应格式无效，请重试');
  const reply = result.data;
  if (!reply.scope.split(/[ ,]+/).includes('repo')) throw new Error('未授予私有仓库权限，无法启用同步');
  return {
    accessToken: reply.access_token,
    refreshToken: reply.refresh_token,
    expiresAt: reply.expires_in === undefined ? undefined : now + reply.expires_in * 1000,
    refreshExpiresAt:
      reply.refresh_token_expires_in === undefined ? undefined : now + reply.refresh_token_expires_in * 1000,
  };
}

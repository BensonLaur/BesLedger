import { z } from 'zod';
import { appIdentitySchema, githubApp, sameApp, type GitHubAppIdentity } from './app';

const token = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9_.-]+$/);
export const tokensSchema = z.object({
  accessToken: token.refine((value) => value.startsWith('ghu_')),
  refreshToken: token.optional(),
  expiresAt: z.number().finite().optional(),
  refreshExpiresAt: z.number().finite().optional(),
  app: appIdentitySchema,
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
  app: appIdentitySchema,
});
export function parseTokenReply(
  value: unknown,
  now = Date.now(),
  expectedApp: GitHubAppIdentity | undefined = githubApp,
): AuthTokens {
  const result = replySchema.safeParse(value);
  if (!result.success) throw new Error('GitHub 授权响应格式无效，请重试');
  const reply = result.data;
  if (reply.scope !== '' || !reply.access_token.startsWith('ghu_') || !sameApp(reply.app, expectedApp))
    throw new Error('授权响应不属于当前最小权限 GitHub App，已拒绝保存');
  return {
    accessToken: reply.access_token,
    app: reply.app,
    refreshToken: reply.refresh_token,
    expiresAt: reply.expires_in === undefined ? undefined : now + reply.expires_in * 1000,
    refreshExpiresAt:
      reply.refresh_token_expires_in === undefined ? undefined : now + reply.refresh_token_expires_in * 1000,
  };
}

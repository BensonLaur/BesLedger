import { z } from 'zod';

export const appIdentitySchema = z.object({
  id: z.number().int().positive(),
  clientId: z
    .string()
    .regex(/^Iv[A-Za-z0-9.]+$/)
    .max(100),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100),
});
export type GitHubAppIdentity = z.infer<typeof appIdentitySchema>;
const parsed = appIdentitySchema.safeParse({
  id: Number(import.meta.env.VITE_GITHUB_APP_ID),
  clientId: import.meta.env.VITE_GITHUB_APP_CLIENT_ID,
  slug: import.meta.env.VITE_GITHUB_APP_SLUG,
});
export const githubApp = parsed.success ? parsed.data : undefined;
export function sameApp(a: GitHubAppIdentity, b?: GitHubAppIdentity): boolean {
  return !!b && a.id === b.id && a.clientId === b.clientId && a.slug === b.slug;
}
export function validRepositoryName(name: string): boolean {
  return /^[A-Za-z0-9_.-]{1,100}$/.test(name) && !['.', '..'].includes(name);
}
export function assertMinimalPermissions(permissions: Record<string, string>): void {
  const allowed: Record<string, string> = {
    metadata: 'read',
    contents: 'write',
    repository_creation: 'write',
  };
  if (Object.entries(permissions).some(([key, value]) => value !== 'none' && allowed[key] !== value))
    throw new Error(
      'GitHub App 安装包含多余权限，请仅保留 Contents 写入、Repository creation 写入和 Metadata 只读',
    );
  if (Object.entries(allowed).some(([key, value]) => permissions[key] !== value))
    throw new Error('GitHub App 尚未授予专用账本所需的最小权限，请检查安装设置');
}

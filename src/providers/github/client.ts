import { decode, encode, envelopeSchema } from '../../crypto/vault';
import { assertMinimalPermissions, validRepositoryName, githubApp, type GitHubAppIdentity } from './app';
export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type GitHubUser = { id: number; login: string };
export type Repository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: GitHubUser;
  permissions?: { push: boolean };
  default_branch: string;
};
export type RemoteFile = { sha: string; text: string };
export type AppInstallation = {
  id: number;
  app_id: number;
  account: GitHubUser;
  target_type: string;
  repository_selection: 'all' | 'selected';
  permissions: Record<string, string>;
  suspended_at?: string | null;
};
export class RepositoryNotGranted extends Error {
  constructor() {
    super('此仓库尚未授予 BesLedger GitHub App，请检查安装范围');
  }
}
export class RepositoryNotDedicated extends Error {}
export class GitHub {
  constructor(
    private accessToken: string,
    private transport: typeof fetch = (input, init) => fetch(input, init),
    private app: GitHubAppIdentity | undefined = githubApp,
  ) {}
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await this.transport(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.accessToken}`,
        'X-GitHub-Api-Version': '2026-03-10',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
      cache: 'no-store',
    });
    if (!response.ok)
      throw new GitHubError(
        response.status,
        response.status === 401
          ? 'GitHub 授权已失效，请重新连接'
          : response.status === 403
            ? 'GitHub 权限不足或请求达到限制'
            : response.status === 409 || response.status === 422
              ? '远端版本已改变，请重新同步'
              : `GitHub 请求失败（${response.status}）`,
      );
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }
  user(): Promise<GitHubUser> {
    return this.request('/user');
  }
  async installation(): Promise<{ user: GitHubUser; installation: AppInstallation }> {
    if (!this.app) throw new Error('GitHub App 尚未配置，禁止使用旧 OAuth 授权访问仓库');
    const user = await this.user();
    let installed: AppInstallation | undefined;
    for (let page = 1; ; page++) {
      const result = await this.request<{ installations: AppInstallation[] }>(
        `/user/installations?per_page=100&page=${page}`,
      );
      if (!Array.isArray(result.installations)) throw new Error('GitHub App 安装信息格式无效');
      installed = result.installations.find(
        (item) => item.app_id === this.app!.id && item.account.id === user.id && item.target_type === 'User',
      );
      if (installed || result.installations.length < 100) break;
    }
    if (!installed)
      throw new Error('请先安装 BesLedger Sync；选择 All repositories 后，应用会自动准备私有账本仓库');
    if (installed.suspended_at) throw new Error('GitHub App 安装已暂停，请在 GitHub 恢复后重试');
    if (!['all', 'selected'].includes(installed.repository_selection)) throw new Error('GitHub 安装范围无效');
    assertMinimalPermissions(installed.permissions);
    return { user, installation: installed };
  }
  private async selectedRepositories(installation: AppInstallation): Promise<Repository[]> {
    // 全部仓库授权不等于枚举全部仓库；只查询固定候选名及本机已有绑定。
    if (installation.repository_selection === 'all') return [];
    const all: Repository[] = [];
    for (let page = 1; ; page++) {
      const result = await this.request<{ repositories: Repository[] }>(
        `/user/installations/${installation.id}/repositories?per_page=100&page=${page}`,
      );
      const current = result.repositories;
      if (!Array.isArray(current)) throw new Error('GitHub App 仓库范围格式无效');
      all.push(...current);
      if (current.length < 100) break;
    }
    return all;
  }
  private candidateNames(user: GitHubUser): string[] {
    return ['BesLedger-Data', `BesLedger-Data-${this.app!.id}`, `BesLedger-Data-${this.app!.id}-${user.id}`];
  }
  private async privateMetadata(owner: string, repo: string, userId?: number): Promise<Repository> {
    const context = await this.installation();
    if (userId !== undefined && context.user.id !== userId) throw new Error('GitHub 账号与账本绑定不一致');
    if (context.user.login.toLowerCase() !== owner.toLowerCase())
      throw new Error('只能使用自己的私有账本仓库');
    const selected = (await this.selectedRepositories(context.installation)).find(
      (item) => item.name === repo && item.owner.id === context.user.id,
    );
    if (context.installation.repository_selection === 'selected' && !selected)
      throw new RepositoryNotGranted();
    const info = await this.request<Repository>(this.repoPath(owner, repo));
    if (!info.private) throw new RepositoryNotDedicated('该仓库不是私有仓库，已禁止传输账本');
    if ((selected && info.id !== selected.id) || info.owner.id !== context.user.id)
      throw new Error('仓库身份与安装范围不一致');
    if (!info.permissions?.push) throw new Error('当前授权没有仓库写入权限');
    return info;
  }
  private async marker(info: Repository): Promise<boolean> {
    try {
      const file = await this.request<{ content: string; encoding: string; size: number }>(
        `${this.repoPath(info.owner.login, info.name)}/contents/besledger/repository.json`,
      );
      if (file.encoding !== 'base64' || file.size > 4096) return false;
      let marker: Record<string, unknown>;
      try {
        marker = JSON.parse(new TextDecoder().decode(decode(file.content.replaceAll('\n', ''))));
      } catch {
        return false;
      }
      if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return false;
      return (
        marker.format === 'BesLedger.repository' &&
        marker.version === 1 &&
        marker.repositoryId === info.id &&
        marker.ownerId === info.owner.id
      );
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 404) throw error;
    }
    // 兼容已实际同步过的旧版仓库，以专用目录和加密文件格式识别，不依赖名字前缀。
    const base = this.repoPath(info.owner.login, info.name);
    try {
      const root = await this.request<{ name: string; type: string }[]>(`${base}/contents`);
      if (!Array.isArray(root) || root.some((f) => !['README.md', 'besledger'].includes(f.name)))
        return false;
      const files = await this.request<{ name: string; type: string }[]>(`${base}/contents/besledger/v1`);
      if (
        !Array.isArray(files) ||
        !files.length ||
        files.some((f) => f.type !== 'file' || !/^[a-f0-9-]{36}\.json$/.test(f.name))
      )
        return false;
      const file = await this.request<{ content: string; encoding: string; size: number }>(
        `${base}/contents/besledger/v1/${files[0].name}`,
      );
      if (file.encoding !== 'base64' || file.size > 25_000_000) return false;
      try {
        return envelopeSchema.safeParse(
          JSON.parse(new TextDecoder().decode(decode(file.content.replaceAll('\n', '')))),
        ).success;
      } catch {
        return false;
      }
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) return false;
      throw error;
    }
  }
  async verifyPrivate(owner: string, repo: string, userId?: number): Promise<Repository> {
    const info = await this.privateMetadata(owner, repo, userId);
    if (!(await this.marker(info)))
      throw new RepositoryNotDedicated('此仓库尚未确认为 BesLedger 账本存储，已停止读写，不会覆盖原内容');
    return info;
  }
  async repositories(known: string[] = []): Promise<Repository[]> {
    const { user, installation } = await this.installation();
    const selected = await this.selectedRepositories(installation);
    const names = [
      ...new Set([
        ...known,
        ...this.candidateNames(user),
        ...selected.filter((r) => r.private && r.owner.id === user.id).map((r) => r.name),
      ]),
    ];
    const result: Repository[] = [];
    for (const name of names) {
      if (!validRepositoryName(name)) continue;
      try {
        const info = await this.privateMetadata(user.login, name, user.id);
        if (await this.marker(info)) result.push(info);
      } catch (error) {
        if (
          error instanceof RepositoryNotDedicated ||
          error instanceof RepositoryNotGranted ||
          (error instanceof GitHubError && error.status === 404)
        )
          continue;
        throw error;
      }
    }
    return result;
  }
  async prepareRepository(known: string[] = []): Promise<Repository> {
    const { user } = await this.installation();
    // 已有绑定优先，避免升级或新页面打开时把旧账本切到新空库。
    for (const name of [...new Set(known)]) {
      try {
        return await this.verifyPrivate(user.login, name, user.id);
      } catch (error) {
        if (
          !(error instanceof RepositoryNotGranted) &&
          !(error instanceof GitHubError && error.status === 404)
        )
          throw error;
      }
    }
    if (known.length) throw new Error('原云端存储当前不可见，请检查授权或仓库状态；不会自动换成新空库');
    for (const name of this.candidateNames(user)) {
      try {
        const info = await this.privateMetadata(user.login, name, user.id);
        if (await this.marker(info)) return info;
        continue; // 同名但不属于本应用的内容保持不动，自动采用下一个稳定名称。
      } catch (error) {
        if (error instanceof RepositoryNotDedicated) continue;
        if (
          !(error instanceof RepositoryNotGranted) &&
          !(error instanceof GitHubError && error.status === 404)
        )
          throw error;
      }
      try {
        return await this.createRepository(name);
      } catch (error) {
        if (!(error instanceof GitHubError) || error.status !== 422) throw error;
        // 另一设备可能已创建但尚未写好标记；只重读，不覆盖文件或重复 POST。
        for (let attempt = 0; attempt < 3; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
          try {
            const info = await this.privateMetadata(user.login, name, user.id);
            if (await this.marker(info)) return info;
          } catch (readError) {
            if (
              !(readError instanceof RepositoryNotGranted) &&
              !(readError instanceof GitHubError && readError.status === 404)
            )
              throw readError;
          }
        }
      }
    }
    throw new Error('自动存储名称均已被其他内容占用，原仓库保持不变；请从高级设置选择已确认的账本仓库');
  }
  async createRepository(name: string): Promise<Repository> {
    if (!validRepositoryName(name)) throw new Error('仓库名称格式无效');
    const { user } = await this.installation();
    const created = await this.request<Repository>('/user/repos', 'POST', {
      name,
      private: true,
      auto_init: true,
      description: 'BesLedger 客户端加密账本数据',
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    });
    // GitHub 会自动授予新建仓库；只等待该范围传播，不再次执行创建请求。
    for (let attempt = 0; ; attempt++) {
      try {
        const info = await this.privateMetadata(user.login, name, user.id);
        if (info.id !== created.id) throw new Error('新建仓库身份不一致，已停止初始化');
        const content = encode(
          new TextEncoder().encode(
            JSON.stringify({
              format: 'BesLedger.repository',
              version: 1,
              repositoryId: info.id,
              ownerId: user.id,
            }),
          ),
        );
        await this.request(`${this.repoPath(user.login, name)}/contents/besledger/repository.json`, 'PUT', {
          message: '初始化加密账本存储标记',
          content,
        });
        return await this.verifyPrivate(user.login, name, user.id);
      } catch (error) {
        if (
          !(error instanceof RepositoryNotGranted) &&
          !(error instanceof GitHubError && error.status === 404)
        )
          throw error;
        if (attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
      }
    }
  }
  private repoPath(owner: string, repo: string): string {
    if (!/^[\w.-]+$/.test(owner) || !validRepositoryName(repo)) throw new Error('仓库标识无效');
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  }
  async discover(owner: string, repo: string, userId: number): Promise<{ id: string; sha: string }[]> {
    await this.verifyPrivate(owner, repo, userId);
    try {
      const files = await this.request<{ name: string; sha: string; type: string }[]>(
        `${this.repoPath(owner, repo)}/contents/besledger/v1`,
      );
      if (!Array.isArray(files)) throw new Error('远端账本目录格式错误');
      return files
        .filter((f) => f.type === 'file' && /^[a-f0-9-]{36}\.json$/.test(f.name))
        .map((f) => ({ id: f.name.slice(0, -5), sha: f.sha }));
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) return [];
      throw error;
    }
  }
  private ledgerPath(owner: string, repo: string, id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('账本身份格式无效');
    return `${this.repoPath(owner, repo)}/contents/besledger/v1/${id}.json`;
  }
  async readLedger(owner: string, repo: string, id: string, userId: number): Promise<RemoteFile | undefined> {
    await this.verifyPrivate(owner, repo, userId);
    try {
      let file = await this.request<{ sha: string; content: string; encoding: string; size: number }>(
        this.ledgerPath(owner, repo, id),
      );
      if (file.size > 25_000_000) throw new Error('远端单本账超过当前 25 MB 安全读取上限');
      if (file.encoding !== 'base64')
        file = await this.request(`${this.repoPath(owner, repo)}/git/blobs/${file.sha}`);
      return { sha: file.sha, text: new TextDecoder().decode(decode(file.content.replaceAll('\n', ''))) };
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) return undefined;
      throw error;
    }
  }
  async writeLedger(
    owner: string,
    repo: string,
    id: string,
    userId: number,
    text: string,
    sha?: string,
  ): Promise<string> {
    if (text.length > 25_000_000) throw new Error('单本加密账超过 25 MB 上限，未上传，请先导出备份');
    await this.verifyPrivate(owner, repo, userId);
    const response = await this.request<{ content: { sha: string } }>(
      this.ledgerPath(owner, repo, id),
      'PUT',
      {
        message: '同步加密账本',
        content: encode(new TextEncoder().encode(text)),
        ...(sha ? { sha } : {}),
      },
    );
    return response.content.sha;
  }
}

import { decode, encode } from '../../crypto/vault';
import { assertMinimalPermissions, dedicatedRepository, githubApp, type GitHubAppIdentity } from './app';
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
    super('此仓库未授予 BesLedger GitHub App，请在 Only select repositories 中仅选择专用私有账本仓库');
  }
}
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
    if (!installed) throw new Error('请先将 BesLedger GitHub App 安装到自己的个人账号，并仅选择专用账本仓库');
    if (installed.suspended_at) throw new Error('GitHub App 安装已暂停，请在 GitHub 恢复后重试');
    if (installed.repository_selection !== 'selected')
      throw new Error('当前安装允许访问全部仓库，已停止云端操作；请改为 Only select repositories');
    assertMinimalPermissions(installed.permissions);
    return { user, installation: installed };
  }
  private async repositoryContext(): Promise<{ user: GitHubUser; repositories: Repository[] }> {
    const { user, installation } = await this.installation();
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
    // 选中无关仓库也视为安装配置错误，不能仅在列表中隐藏后继续使用宽权限令牌。
    if (all.some((repo) => !repo.private || repo.owner.id !== user.id || !dedicatedRepository(repo.name)))
      throw new Error('安装中包含非专用或非私有仓库，请仅保留自己的 BesLedger-Data 专用数据仓库');
    return { user, repositories: all };
  }
  async repositories(): Promise<Repository[]> {
    return (await this.repositoryContext()).repositories;
  }
  async verifyPrivate(owner: string, repo: string, userId?: number): Promise<Repository> {
    if (!dedicatedRepository(repo)) throw new RepositoryNotGranted();
    const context = await this.repositoryContext();
    if (userId !== undefined && context.user.id !== userId) throw new Error('GitHub 账号与账本绑定不一致');
    const selected = context.repositories.find(
      (item) => item.owner.login.toLowerCase() === owner.toLowerCase() && item.name === repo,
    );
    if (!selected) throw new RepositoryNotGranted();
    const info = await this.request<Repository>(this.repoPath(owner, repo));
    if (!info.private) throw new Error('该仓库不是私有仓库，已禁止传输账本');
    if (info.id !== selected.id || info.owner.id !== context.user.id)
      throw new Error('仓库身份与安装范围不一致');
    if (!info.permissions?.push) throw new Error('当前授权没有仓库写入权限');
    return info;
  }
  async createRepository(name: string): Promise<Repository> {
    if (!dedicatedRepository(name)) throw new Error('请使用 BesLedger-Data 或 BesLedger-Data-用途 命名');
    const { user, repositories } = await this.repositoryContext();
    if (repositories.some((repo) => repo.name === name))
      throw new Error('同名仓库已授权，请选择已有仓库；不会覆盖内容');
    try {
      await this.request('/user/repos', 'POST', {
        name,
        private: true,
        auto_init: true,
        description: 'BesLedger 客户端加密账本数据',
        has_issues: false,
        has_projects: false,
        has_wiki: false,
      });
    } catch (error) {
      if (error instanceof GitHubError && error.status === 422)
        throw new Error(
          '仓库未创建：同名仓库可能已存在但尚未授权，或名称不符合 GitHub 规则；请检查安装范围，不会覆盖原数据',
        );
      throw error;
    }
    // GitHub 会自动授予新建仓库；只等待该范围传播，不再次执行创建请求。
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.verifyPrivate(user.login, name, user.id);
      } catch (error) {
        if (!(error instanceof RepositoryNotGranted) || attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
      }
    }
  }
  private repoPath(owner: string, repo: string): string {
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw new Error('仓库标识无效');
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

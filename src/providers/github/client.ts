import { decode, encode } from '../../crypto/vault';
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
  name: string;
  full_name: string;
  private: boolean;
  owner: GitHubUser;
  permissions?: { push: boolean };
  default_branch: string;
};
export type RemoteFile = { sha: string; text: string };
export class GitHub {
  constructor(
    private accessToken: string,
    private transport: typeof fetch = fetch,
  ) {}
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await this.transport(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
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
  async repositories(): Promise<Repository[]> {
    const all: Repository[] = [];
    for (let page = 1; ; page++) {
      const current = await this.request<Repository[]>(
        `/user/repos?affiliation=owner&visibility=private&per_page=100&page=${page}`,
      );
      all.push(...current);
      if (current.length < 100) break;
    }
    return all;
  }
  async verifyPrivate(owner: string, repo: string, userId?: number): Promise<Repository> {
    const info = await this.request<Repository>(this.repoPath(owner, repo));
    if (!info.private) throw new Error('该仓库不是私有仓库，已禁止传输账本');
    if (userId !== undefined && info.owner.id !== userId) throw new Error('仓库不属于当前 GitHub 账号');
    if (!info.permissions?.push) throw new Error('当前授权没有仓库写入权限');
    return info;
  }
  async createRepository(name: string): Promise<Repository> {
    if (!/^BesLedger-Data(?:-[\w-]+)?$/.test(name))
      throw new Error('请使用 BesLedger-Data 或 BesLedger-Data-用途 命名');
    const user = await this.user();
    try {
      await this.request(this.repoPath(user.login, name));
      throw new Error('同名仓库已存在，请选择并核对，不能覆盖');
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 404) throw error;
    }
    await this.request('/user/repos', 'POST', {
      name,
      private: true,
      auto_init: true,
      description: 'BesLedger 客户端加密账本数据',
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    });
    return this.verifyPrivate(user.login, name, user.id);
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

// 仅测试用的 GitHub API 替身：保存真实客户端生成的密文，不冒充真实授权验收。
export function githubSyncFixture(appId = 7) {
  const user = { id: 42, login: 'fictional-user' };
  const files = new Map<string, { content: string; sha: string }>();
  let version = 0;
  const result = (body: unknown, status = 200) => ({ body, status });
  return {
    files,
    handle(url: string, method: string, input?: { content?: string; sha?: string }) {
      const path = new URL(url).pathname;
      if (path === '/user') return result(user);
      if (path === '/user/installations')
        return result({
          installations: [
            {
              id: 11,
              app_id: appId,
              account: user,
              target_type: 'User',
              repository_selection: 'all',
              permissions: { contents: 'write', repository_creation: 'write', metadata: 'read' },
              suspended_at: null,
            },
          ],
        });
      if (path === '/repos/fictional-user/BesLedger-Data')
        return result({
          id: 501,
          name: 'BesLedger-Data',
          full_name: 'fictional-user/BesLedger-Data',
          private: true,
          owner: user,
          permissions: { push: true },
          default_branch: 'main',
        });
      if (path.endsWith('/contents/besledger/repository.json'))
        return result({
          encoding: 'base64',
          size: 120,
          content: Buffer.from(
            JSON.stringify({ format: 'BesLedger.repository', version: 1, repositoryId: 501, ownerId: 42 }),
          ).toString('base64'),
        });
      if (path.endsWith('/contents/besledger/v1'))
        return result([...files.entries()].map(([name, f]) => ({ name, type: 'file', sha: f.sha })));
      const name = path.match(/\/contents\/besledger\/v1\/([a-f0-9-]{36}\.json)$/)?.[1];
      if (!name) return result({}, 404);
      const saved = files.get(name);
      if (method === 'PUT') {
        if (input?.sha !== saved?.sha || !input?.content) return result({}, 409);
        const sha = String(++version).padStart(40, '0');
        files.set(name, { content: input.content, sha });
        return result({ content: { sha } }, 201);
      }
      return saved
        ? result({ ...saved, encoding: 'base64', size: Buffer.from(saved.content, 'base64').length })
        : result({}, 404);
    },
  };
}

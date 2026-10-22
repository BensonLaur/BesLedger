import { createRelay, type Env } from './index';

export function createVercelRelay(transport: typeof fetch = fetch) {
  // Vercel 重写此平台头；不信任客户端自行携带的 CF-Connecting-IP。
  const relay = createRelay(
    transport,
    (request) => request.headers.get('x-vercel-forwarded-for') || 'local',
  );
  return (request: Request, env: Env): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    if (!['/', '/health', '/device', '/token', '/refresh'].includes(path))
      return Promise.resolve(new Response('Not found', { status: 404 }));
    url.pathname = path;
    // 仅映射固定路径，不从查询参数读取上游地址或登录凭证。
    url.search = '';
    return relay.fetch(new Request(url, request), env);
  };
}

// 发布前验证匿名可达性和浏览器预检；不创建授权码，也不接触任何用户令牌。
const service = new URL(process.env.BESLEDGER_AUTH_SERVICE || '');
if (service.protocol !== 'https:' || service.username || service.password || service.search || service.hash)
  throw new Error('发布配置中的授权服务必须是无凭证参数的 HTTPS 地址');
const origin = 'https://bensonlaur.github.io';
const expected = {
  id: Number(process.env.BESLEDGER_GITHUB_APP_ID),
  clientId: process.env.BESLEDGER_GITHUB_APP_CLIENT_ID,
  slug: process.env.BESLEDGER_GITHUB_APP_SLUG,
};
async function check(path, init) {
  const response = await fetch(`${service.href.replace(/\/$/, '')}/${path}`, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`授权服务 ${path} 检查失败：HTTP ${response.status}`);
  if (response.headers.get('Access-Control-Allow-Origin') !== origin)
    throw new Error(`授权服务 ${path} 未允许正式 Web 来源`);
  if (response.headers.get('Cache-Control') !== 'no-store')
    throw new Error(`授权服务 ${path} 缺少禁止缓存设置`);
  return response;
}
const health = await check('health', { headers: { Origin: origin } });
const status = await health.json();
if (
  !status.configured ||
  !expected.id ||
  Object.entries(expected).some(([key, value]) => !value || status.app?.[key] !== value)
)
  throw new Error('授权服务未就绪或 GitHub App 身份不匹配');
for (const path of ['device', 'token', 'refresh']) {
  const response = await check(path, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  if (
    response.status !== 204 ||
    !response.headers.get('Access-Control-Allow-Methods')?.split(/\s*,\s*/).includes('POST') ||
    !response.headers.get('Access-Control-Allow-Headers')?.toLowerCase().split(/\s*,\s*/).includes('content-type')
  )
    throw new Error(`授权服务 ${path} 预检配置不完整`);
}
console.log('PASS: 公开授权服务、固定 App 身份及三项跨域预检均通过；未使用用户令牌');

# BesLedger 登录中转（维护者部署）

普通用户直接使用发布的 Web/PWA，不注册托管账号、不部署服务、不填写端点。维护者负责此服务与发布时内置的地址；Android 自 versionCode 8 直接连接 GitHub，不依赖中转。

当前使用 Cloudflare Pages Functions，共享 Workers Free 每日 100,000 次请求额度。生产地址为 https://besledger-github-auth.pages.dev；超额可能停止服务，不自动升级付费方案。维护者已完成 Cloudflare 注册和受限授权，未要求手机号。Vercel 迁移因短信验证不可达而取消，未部署 Vercel 项目。

## 维护命令

在本目录使用 Node 24，Wrangler 4.152.0 已由 package-lock.json 锁定：

```powershell
npm ci
npm run check
npm run deploy
```

部署前需通过官方 Wrangler 登录；使用系统密钥链保护凭证，并只请求必要权限：

```powershell
npx wrangler login --device --browser=false --use-keyring --scopes account:read user:read workers_scripts:write pages:write
```

账号信息读取、Workers 脚本和 Pages 管理仍是账号级授权，不宣称限于单个项目。部署只针对本任务的 besledger-github-auth；同名已有项目必须先核实归属，不覆盖未知内容。多账号时由维护者设置 CLOUDFLARE_ACCOUNT_ID。不要将部署凭证复制到源码、聊天或 Web 构建变量。

首次创建 Pages 项目需使用 Wrangler 4.152.0 提供的显式 Pages 选项：wrangler pages project create besledger-github-auth --cwd pages --production-branch main --force。这里的 --force 仅选择原 Pages 产品，防止 CLI 自动转为 workers.dev 部署，并非强制覆盖。项目现已存在，后续不要重复创建。单独 Worker 曾上传成功，但当前网络对 workers.dev 的解析异常、连接超时；因此生产使用实测可达的 pages.dev。

## 配置与验证

pages/wrangler.jsonc 固定公开 GitHub App 身份和生产 Web 来源，只允许已发布的 GitHub Pages 来源发起授权请求。无 Client Secret、App 私钥或财务数据配置项；不建立数据库、KV、R2 或付费绑定，不记录请求正文和令牌，不上传源码映射。public/_routes.json 仅允许五个固定路径进入函数，其余请求由静态托管处理。

服务只转发 GitHub 的设备码、换取令牌和续期三个固定端点，拒绝上游重定向，不记录请求正文或令牌。访问令牌和刷新令牌会短暂经过服务，账目与恢复密钥不会进入服务。

部署后先验证匿名 GET /health、正式来源的 OPTIONS 预检和真实 Device Flow，再更新源码仓库的 BESLEDGER_AUTH_SERVICE，发布 Web/PWA。scripts/check-auth-service.mjs 会在 Pages 发布前核对公开可达性、App 身份和三项跨域预检；这不是持续监控，也不替代真实浏览器登录和跨端同步验收。

与 GitHub 之间的网络、免费额度和各地区网络条件仍可能影响可用性。出现故障应由维护者修复服务；普通用户不需要自建中转。保持相同 GitHub App 身份后，更换中转地址不会主动清除本机已有登录。

官方依据：[账号注册](https://developers.cloudflare.com/fundamentals/account/create-account/)、[Pages Functions 免费额度](https://developers.cloudflare.com/pages/functions/pricing/)、[Wrangler 登录及系统密钥链](https://developers.cloudflare.com/workers/wrangler/commands/general/#login)。实际部署地址和验收结果见 [部署说明](../../docs/DEPLOYMENT.md)。

# GitHub App 注册与自动同步安装

2026-10-22：改用 GitHub App。旧 OAuth App 的 repo 权限不能缩小成单仓库授权；旧凭证不会被新版继续使用。本地加密账本和数据仓库保持原状。

## 维护者只需做一次的注册

打开 https://github.com/settings/apps/new （Developer settings → GitHub Apps → New GitHub App）。这里不是 OAuth Apps。

| 字段 | 填写值 |
| --- | --- |
| GitHub App name | BesLedger Sync；若名称已被占用，使用 BesLedger Sync BensonLaur |
| Description | Bes记账：仅在专用私有账本仓库中同步客户端加密数据。 |
| Homepage URL | https://bensonlaur.github.io/BesLedger/ |
| Callback URL | https://bensonlaur.github.io/BesLedger/ |
| Expire user authorization tokens | 勾选，保留短期令牌与自动续期 |
| Request user authorization (OAuth) during installation | 不勾选，本版使用 Device Flow 单独登录 |
| Enable Device Flow | 勾选 |
| Setup URL | 留空 |
| Webhook → Active | 取消勾选；不需要 Webhook URL 或 Secret |
| Where can this GitHub App be installed? | Any account，让未来用户也能安装 |

Repository permissions 仅设置下列三项；其余仓库、组织和账号权限均为 No access：

- Contents：Read and write。
- Repository creation：Write；如果界面名称为 Read and write，选择该写入级别。
- Metadata：Read-only（GitHub 通常会自动附加）。

不要选择 Administration、Workflows、Actions、成员、组织管理或其他权限。点击 Create GitHub App 后，将公开的 **App ID、Client ID、应用公开页面地址（https://github.com/apps/实际-slug）** 提供给实施者。Device Flow 的用户令牌及续期不需要生成 Client Secret 或私钥，不要把这些秘密发进聊天。

## 当前账号的安装

进入新 App 的 Install App，选择自己的个人账号。默认自动准备流程选择 **All repositories**。这是用户在了解范围后于 2026-10-22 明确选择的方案：保留三项能力，允许自动新建私有数据仓库，不回到 OAuth repo。

实际界面已确认：不选择仓库时 Install 禁用，至少必须选择一个。本轮先选已创建且只有虚构密文的 **BesLedger-Data-Acceptance-20261022**；安装后应用真实自动创建 **BesLedger-Data-AppTest-20261022**，GitHub 自动将新仓库加入本 App 范围。不要选 BesLedger 源码仓库或其他业务仓库。

普通用户只需安装 App 并完成登录。应用自动准备私有存储、发现已有账本；无需输入仓库名。优先使用已有绑定，否则检查 BesLedger-Data 及稳定备用名；同名未知用途或公开仓库不覆盖。以专用标记或旧加密目录识别仓库，不依赖名称前缀。

All repositories 允许内容读写覆盖账号内全部及未来仓库，包括私有仓库。代码只使用确认过的账本存储，但令牌泄露或恶意代码仍可能访问其他仓库；开源不等于平台隔离。用户也可自行选择 Only select repositories，代价是首次必须已有专用仓库。未安装时，真实建库请求被 GitHub 403 拒绝，因此任何模式都仍需先安装。

已注册的 App 为 https://github.com/apps/besledger-sync，App ID 5426577，Client ID Iv23liqKVYOk5K5MFB1j。用户已在 Advanced 将注册改为 Public，API 返回的权限恰好是上述三项。App 注册公开不改变任何数据仓库的私有性。

安装后返回 BesLedger 完成一次应用内登录。应用核对本人账号、固定 App 身份、三项能力、存储标记、私有性和仓库数字 ID。发现额外能力、暂停安装、账号不符或未知内容时停止相关操作；不读取无关仓库文件，不降级到 OAuth/PAT。

## 收回旧 OAuth 授权

打开 https://github.com/settings/applications → Authorized OAuth Apps，找到原来的 **BesLedger**，选择 Revoke。这会收回先前两套测试客户端的宽权限授权，不会删除本地账本或 GitHub 数据仓库。新 GitHub App 安装是独立的授权。

## 官方依据

- [GitHub App 权限选择](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)：Repository creation 可代替仅为建库而申请的 Administration；应用自动取得它创建的仓库的访问权。
- [GitHub App Device Flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app#using-the-device-flow-to-generate-a-user-access-token)：只请求 offline_access，不请求 repo。
- [GitHub App 用户令牌续期](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)：Device Flow 生成的令牌续期无需 Client Secret。

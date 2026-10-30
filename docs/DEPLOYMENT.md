# 部署与交付操作

当前阶段 Web：https://bensonlaur.github.io/BesLedger/。源码：https://github.com/BensonLaur/BesLedger。

当前统一下载入口为 [0.1.3](https://github.com/BensonLaur/BesLedger/releases/tag/v0.1.3)：长期签名 Android versionCode 11、对应 Web/PWA、SHA-256 与签名说明。包名与原签名不变，可直接覆盖升级；先独立保存加密备份及恢复密钥，不先卸载或清空数据。

最新安卓测试包为 [0.1.4-test.1](https://github.com/BensonLaur/BesLedger/releases/tag/v0.1.4-test.1)，versionCode 13，沿用同一包名和证书，包含本轮界面与备注自动填入。该预发布只提供 APK、SHA-256 与签名说明，未替换公开稳定 Web/PWA；安装与验证边界见 [安卓测试说明](ANDROID_TESTING.md)。

旧 v0.1.0-preview.1、v0.1.0、web-20261023、v0.1.1、v0.1.2 的版本与校验信息见 [历史版本记录](RELEASE_ARCHIVE.md)，不再作为当前下载入口。源码标签和提交继续保留。备用站点为 https://besledger-bensonlaur.pages.dev/BesLedger/；两个站点各自保存本地数据，已有用户继续使用原网址。

## Web/PWA

`npm ci && npm run build` 生成 dist，固定部署子路径 /BesLedger/。GitHub Pages 使用 .github/workflows/pages.yml；推送 master 或手动运行触发。只有 dist 会公开，private、.env、测试报告、签名文件不进入发布目录。

首次联网访问完成 Service Worker 缓存后可离线重开。更新可用时先保存草稿，再点击重新加载；本地解锁空间独立于应用缓存。清理浏览器站点数据会删除本机账本，请先导出加密备份。

GitHub Pages 与 Cloudflare 备用网址具有不同浏览器来源，本地账本和登录不会自动互通。已有用户继续使用原网址即可取得中转修复；不要通过清空站点数据强制更新。需要换网址时先导出加密备份，或在新网址登录后输入原设备同步恢复密钥下载；新来源首次 GitHub 登录属于新客户端，之后仍安全保持登录。

维护者更新备用站点时，先设置上述四个公开 VITE_ 构建变量并运行 npm run build，将 dist 的内容复制到一个新建暂存目录的 public/BesLedger/，在 public/_redirects 写入 `/ /BesLedger/ 302`。暂存目录的 wrangler.jsonc 使用 name=besledger-bensonlaur、pages_build_output_dir=./public、compatibility_date=2026-10-21、send_metrics=false，再运行仓库 services/auth-relay/node_modules/wrangler/bin/wrangler.js 的 pages deploy，指定 --cwd 暂存目录、--project-name besledger-bensonlaur、--branch main、--upload-source-maps=false。只上传公开构建目录，禁止指向仓库根目录。当前项目已存在，不重复创建。

## GitHub App 注册与配置

2026-10-22 改用公开的 [BesLedger Sync](https://github.com/apps/besledger-sync) GitHub App。App ID 为 5426577，公开 Client ID 为 Iv23liqKVYOk5K5MFB1j。仅 Contents 写入、Repository creation 写入、Metadata 只读；按用户最新决定，默认选择 All repositories 以实现首次自动建库。范围包含其他私有仓库的内容读写，必须如实说明。维护者注册步骤见 GITHUB_APP_SETUP.md，普通用户无需注册应用。

开启 Device Flow 和 Expire user access tokens，关闭 Webhook。本版只请求 offline_access，登录及续期均不需要 Client Secret 或 App 私钥。Web 服务配置 GITHUB_CLIENT_ID、GITHUB_APP_ID、GITHUB_APP_SLUG，以及固定来源 ALLOWED_ORIGINS；Android 使用原生网络直连 GitHub 授权端点，不依赖该中转。旧 OAuth App 的 repo 授权不再使用，用户已确认撤销旧 BesLedger。

2026-10-23：Web/PWA 的共享中转已迁到 Cloudflare Pages Functions，地址 https://besledger-github-auth.pages.dev，由维护者统一部署并内置到发布包。普通用户无需托管账号、手机号验证、部署或配置服务。当前网络匿名健康检查、三项跨域预检，以及两套独立浏览器的真实登录、续期、双向同步、锁定/离线重开和主动退出均已通过。现有 GitHub App 身份保持不变，迁移本身不清除已保存登录。

授权服务源码在 services/auth-relay/src/index.ts，Pages 入口与配置在 services/auth-relay/pages/，维护命令见 services/auth-relay/README.md。使用锁定的 Wrangler 4.152.0，凭证通过 Windows Credential Manager 加密保护，授权限于用户/账号读取、Workers 脚本及 Pages 管理。免费额度为每天共用 100,000 次函数请求，不引入数据库或付费绑定。

历史原因：Sites 域名在部分网络被托管边缘返回 403；Vercel 因注册短信不可达未部署；Cloudflare 单独 Worker 的 workers.dev 在当前网络解析异常，改用 Pages Functions 的 pages.dev。没有要求用户修改代理、关闭浏览器安全检查或自行搭服务。旧 Sites 与单独 Worker 仅保留历史，不作为新版本默认或自动回退端点。2026-10-23 凌晨 GitHub Actions 曾因平台故障排队，因此同时发布完整 Cloudflare 备用站；GitHub Pages 后续发布已恢复。网络、GitHub 上游和免费额度仍有可用性边界，不承诺所有地区永久可达。

源码仓库变量 BESLEDGER_AUTH_SERVICE 使用上述 HTTPS 地址，并设置 BESLEDGER_GITHUB_APP_ID、BESLEDGER_GITHUB_APP_CLIENT_ID、BESLEDGER_GITHUB_APP_SLUG。Pages 和 Android 构建映射为 VITE_AUTH_SERVICE、VITE_GITHUB_APP_ID、VITE_GITHUB_APP_CLIENT_ID、VITE_GITHUB_APP_SLUG。开发可在被忽略的 .env.local 中配置这四个公开值；秘密不得使用 VITE_ 前缀。

Only select repositories 要求至少选择一个现有仓库；未安装时建库返回 403。最新默认流程为安装 All repositories → 应用登录 → 自动准备私有存储并发现远端账本。名称不由普通用户填写；同名其他用途仓库不覆盖，自动使用稳定备用名。全部仓库模式不枚举所有仓库，只查自动候选与本机已知绑定。高级用户仍可自行限定 selected 范围。

早期协议测试使用独立私有仓库 BensonLaur/BesLedger-Data-SyncTest-20261021 和开发凭证，不作为应用内登录证据。后续两套隔离 Edge 存储和 Android SQLite 客户端均通过实际 GitHub App Device Flow 授权，并连接真实私有仓库完成验收；没有把 gh 登录代替用户登录。自动创建的 BesLedger-Data 保留私有性和存储标记，本轮新建虚构验收账本已从当前分支清理，历史只有虚构密文。

## Android 发布

package ID：com.bensoftware.besledger；Android 10/API 29 起，compile/target 36，WebView 初始支持目标 Chromium 111+。

构建工具锁定为 Capacitor 8.4.3、JDK 21、Gradle 8.14.3 / AGP 8.13.0。Windows 使用 PowerShell 7：

```powershell
./scripts/build-android.ps1 -JavaDirectory <独立JDK绝对路径> -SdkDirectory <AndroidSDK绝对路径>
# 可选 -GradleCacheDirectory <缓存目录>；Windows 缓存目录移动失败或空间不足时使用独立目录
```

本机网络下载 Gradle 极慢时，已用 GitHub Actions 的同一版本组合完成真实构建。手动运行 android-release.yml，产物 besledger-signed-release 包含发布 APK、SHA256SUMS.txt 与 signature.txt。发布使用长期专用签名，不使用调试签名。

签名公钥证书 SHA-256：b54b12f342a892713a8764ae2544e68de234309a266e7a70c6fba87000a22716。私钥与 DPAPI 口令文件在 private/signing，不公开；本项目 Actions secrets 保存用于发布的同一材料。修改代码和 CI 的人可影响构建，因此应严格控制源码仓库写权限。

调试验收包只用于测试，不可覆盖不同签名的发布包。仅在本任务隔离模拟器内删除虚构测试应用后切换签名；真实用户升级不要卸载已有账目，必须使用同签名且递增 versionCode 的 APK。

## 自动化与设备

- npm test：金额、借贷、退款、日期、周期、加密、恢复、冲突和生命周期。
- npm run test:e2e：Edge 桌面、Pixel 7 布局模拟、WebKit iPad 布局；不等于物理 iPad/Android。
- npm run test:auth：三种浏览器/尺寸使用明确模拟的 GitHub App 响应，验证实际加密存储的刷新、关闭重开、锁定恢复、跨窗口退出和续期失效。该测试不冒充真实 GitHub 授权。
- scripts/test-android.mjs：只连接 BesLedgerTestApi36 隔离模拟器，实际原生 SQLite 与离线重启。
- scripts/test-android-sms.mjs：只连接该模拟器，测试普通运行时权限拒绝/授予、日期与银行范围、勾选识别及撤回。运行前安装 Playwright Android 驱动，并先运行基础原生测试。所有短信为新生成虚构内容。
- scripts/test-android-lifecycle.mjs：只连接该模拟器，测试实际软键盘下保存按钮、返回键与未保存草稿、前后台恢复。原生自动化需调试验收包；正式包另行执行验签、安装和启动检查。

短信权限受系统和安装渠道限制，当前仅侧载/模拟器验证；没有 Google Play 审核批准。权限拒绝不阻止备注粘贴。真实设备矩阵、APK 最终哈希与完整范围逐项结果见 IMPLEMENTATION_STATUS.md 和 DELIVERY_VERIFICATION.md。

## 统一版本发布与历史记录

完成工程验证后，用相同应用源文件构建 APK 和 Web/PWA。发布前检查版本标签是否已存在，不为单项修复创建重复 Release。生产包只包含 dist；签名 APK 沿用长期证书和包名，versionCode 必须递增。

清理旧 Release 须依据用户授权，保留源码标签与提交。需要归档时，先保存说明、附件和校验信息并核对；移除公开附件时同步清理下载链接与校验清单。

稳定版 0.1.3 附件包含 APK、Web/PWA ZIP、SHA256SUMS.txt 和 signature.txt；新增 0.1.4-test.1 安卓预发布提供 APK 与校验、签名文件，不替换稳定版入口。两份历史归档 ZIP 已按用户要求移除。GitHub Pages 与 Cloudflare 备用站点使用同一构建，历史文档不再引导下载旧附件。

本轮额外验证入口：`scripts/test-android-interface.mjs` 限定 emulator-5558 / BesLedgerUiApi36；`scripts/test-android-sync-keys.mjs` 可用 BESLEDGER_TEST_SERIAL 指定同一隔离模拟器。`scripts/create-android-upgrade-fixture.mjs` 仅生成虚构的旧格式加密 SQLite 样本，输出到已忽略的 artifacts；仅在隔离模拟器建立基线后进行正式签名包的覆盖升级，禁止注入任何真实用户设备。

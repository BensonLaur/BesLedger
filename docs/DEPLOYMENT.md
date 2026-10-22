# 部署与交付操作

当前阶段 Web：https://bensonlaur.github.io/BesLedger/。源码：https://github.com/BensonLaur/BesLedger。

可下载的 [0.1.0 正式交付版](https://github.com/BensonLaur/BesLedger/releases/tag/v0.1.0) 包含长期签名 APK（versionCode 8）、Web/PWA 生产 ZIP、SHA256SUMS.txt 和公开验签结果。构建源码为 8b3e5587b51ff602a4011226e024d8fc3f471b2c，真实 GitHub App 授权、自动私有建库、Android 原生与 Web 双向同步及续期已通过。文件大小、哈希、设备证据及未覆盖范围见 DELIVERY_VERIFICATION.md；旧 preview.1 仅保留历史。

## Web/PWA

`npm ci && npm run build` 生成 dist，固定部署子路径 /BesLedger/。GitHub Pages 使用 .github/workflows/pages.yml；推送 master 或手动运行触发。只有 dist 会公开，private、.env、测试报告、签名文件不进入发布目录。

首次联网访问完成 Service Worker 缓存后可离线重开。更新可用时先保存草稿，再点击重新加载；本地解锁空间独立于应用缓存。清理浏览器站点数据会删除本机账本，请先导出加密备份。

## GitHub App 注册与配置

2026-10-22 改用公开的 [BesLedger Sync](https://github.com/apps/besledger-sync) GitHub App。App ID 为 5426577，公开 Client ID 为 Iv23liqKVYOk5K5MFB1j。仅 Contents 写入、Repository creation 写入、Metadata 只读；按用户最新决定，默认选择 All repositories 以实现首次自动建库。范围包含其他私有仓库的内容读写，必须如实说明。维护者注册步骤见 GITHUB_APP_SETUP.md，普通用户无需注册应用。

开启 Device Flow 和 Expire user access tokens，关闭 Webhook。本版只请求 offline_access，登录及续期均不需要 Client Secret 或 App 私钥。Web 服务配置 GITHUB_CLIENT_ID、GITHUB_APP_ID、GITHUB_APP_SLUG，以及固定来源 ALLOWED_ORIGINS；Android 使用原生网络直连 GitHub 授权端点，不依赖该中转。旧 OAuth App 的 repo 授权不再使用，用户已确认撤销旧 BesLedger。

实际原生验收发现：当前模拟器直连网络访问托管中转时被平台边缘返回 403，导致 WebView 预检缺少 CORS 头，Worker 的允许来源配置并无遗漏。Android 已改为官方原生 HTTP 直连；Web/PWA 仍需要中转服务可达，受托管平台拦截的网络无法完成 Web 登录，可由维护者在可达环境部署同一服务。没有通过更换请求身份或关闭安全校验绕过托管平台限制。

授权服务源代码在 services/auth-relay/src/index.ts；可用 Wrangler 部署，也已通过 Sites 部署。当前 Sites project_id 为 appgprj_6ad8dc6c8aa0819194ac3849518bc2bd，地址 https://besledger-github-auth.bensonlaur.chatgpt.site。更新运行环境后重新部署既有版本，不重复创建 Site。

源码仓库变量 BESLEDGER_AUTH_SERVICE 使用上述 HTTPS 地址，并设置 BESLEDGER_GITHUB_APP_ID、BESLEDGER_GITHUB_APP_CLIENT_ID、BESLEDGER_GITHUB_APP_SLUG。Pages 和 Android 构建映射为 VITE_AUTH_SERVICE、VITE_GITHUB_APP_ID、VITE_GITHUB_APP_CLIENT_ID、VITE_GITHUB_APP_SLUG。开发可在被忽略的 .env.local 中配置这四个公开值；秘密不得使用 VITE_ 前缀。

Only select repositories 要求至少选择一个现有仓库；未安装时建库返回 403。最新默认流程为安装 All repositories → 应用登录 → 自动准备私有存储并发现远端账本。名称不由普通用户填写；同名其他用途仓库不覆盖，自动使用稳定备用名。全部仓库模式不枚举所有仓库，只查自动候选与本机已知绑定。高级用户仍可自行限定 selected 范围。

早期协议测试使用独立私有仓库 BensonLaur/BesLedger-Data-SyncTest-20261021 和开发凭证，不作为应用内登录证据。后续两套隔离 Edge 存储和 Android SQLite 客户端均通过实际 GitHub App Device Flow 授权，并连接真实私有仓库完成验收；没有把 gh 登录代替用户登录。自动创建的 BesLedger-Data 保留私有性和存储标记，本轮新建虚构验收账本已从当前分支清理，历史只有虚构密文。

## Android 发布

package ID：com.bensoftware.besledger；Android 10/API 29 起，compile/target 36，WebView 初始支持目标 Chromium 111+。

构建工具锁定为 Capacitor 8.4.3、JDK 21、Gradle 8.14.3 / AGP 8.13.0。Windows 使用 PowerShell 7：

```powershell
./scripts/build-android.ps1 -JavaDirectory <独立JDK绝对路径> -SdkDirectory <AndroidSDK绝对路径>
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

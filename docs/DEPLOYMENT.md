# 部署与交付操作

当前阶段 Web：https://bensonlaur.github.io/BesLedger/。源码：https://github.com/BensonLaur/BesLedger。

可下载的 [0.1.0 实施预览版](https://github.com/BensonLaur/BesLedger/releases/tag/v0.1.0-preview.1) 包含长期签名 APK（versionCode 4）、Web/PWA 生产 ZIP、SHA256SUMS.txt 和公开验签结果。该预览版尚未配置真实 OAuth 登录，完整功能不能因此视为已验收。文件大小、哈希、构建提交和设备证据见 DELIVERY_VERIFICATION.md。

## Web/PWA

`npm ci && npm run build` 生成 dist，固定部署子路径 /BesLedger/。GitHub Pages 使用 .github/workflows/pages.yml；推送 master 或手动运行触发。只有 dist 会公开，private、.env、测试报告、签名文件不进入发布目录。

首次联网访问完成 Service Worker 缓存后可离线重开。更新可用时先保存草稿，再点击重新加载；本地解锁空间独立于应用缓存。清理浏览器站点数据会删除本机账本，请先导出加密备份。

## GitHub OAuth 注册与配置

用户已于 2026-10-22 完成 BesLedger OAuth App 注册，提供公开 Client ID，并开启 Device Flow 和 Expire user access tokens。授权服务运行环境已配置该 ID；支持登录保存与自动续期的客户端和服务正在进行实际发布验收。注册成功不能代替后续真实用户授权和跨端同步证据。下面保留部署所需字段供维护者核对，普通应用用户不需要自行注册应用。

1. 在 https://github.com/settings/applications/new 注册 OAuth App，应用名 BesLedger。
2. Homepage URL：https://bensonlaur.github.io/BesLedger/。
3. Authorization callback URL：https://bensonlaur.github.io/BesLedger/。本版使用 Device Flow，不依赖此回调接收 token。
4. 勾选 Enable Device Flow 和 Expire user access tokens。本版支持 refresh token 自动续期，无需生成或提供 Client Secret。
5. 将公开 Client ID 配置到授权服务运行环境 GITHUB_CLIENT_ID。可以把公开 Client ID 提供给实施者；不要提供密码、2FA、client secret 或长期 token。

授权服务源代码在 services/auth-relay/src/index.ts；可用 Wrangler 部署，也已通过 Sites 部署。当前 Sites project_id 为 appgprj_6ad8dc6c8aa0819194ac3849518bc2bd，地址 https://besledger-github-auth.bensonlaur.chatgpt.site。更新运行环境后重新部署既有版本，不重复创建 Site。

随后设置源码仓库变量 BESLEDGER_AUTH_SERVICE 为上面的 HTTPS 地址，并重跑 Pages 和 Android 发布流程。开发验证用 .env.local 的 VITE_AUTH_SERVICE，文件已忽略。完成后必须在两个独立设备/浏览器存储中实际登录，验证创建或选择 BesLedger-Data 私有仓库、读回 private、发现下载、编辑回传、退出/重连与冲突，才能关闭 GitHub 交付项。

已通过的真实 API 测试使用独立私有仓库 BensonLaur/BesLedger-Data-SyncTest-20261021 和虚构加密账。它使用开发凭证验证协议，不作为应用内登录验收证据。

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
- npm run test:auth：三种浏览器/尺寸使用明确模拟的 OAuth 响应，验证实际加密存储的刷新、关闭重开、锁定恢复、跨窗口退出和续期失效。该测试不冒充真实 GitHub 授权。
- scripts/test-android.mjs：只连接 BesLedgerTestApi36 隔离模拟器，实际原生 SQLite 与离线重启。
- scripts/test-android-sms.mjs：只连接该模拟器，测试普通运行时权限拒绝/授予、日期与银行范围、勾选识别及撤回。运行前安装 Playwright Android 驱动，并先运行基础原生测试。所有短信为新生成虚构内容。
- scripts/test-android-lifecycle.mjs：只连接该模拟器，测试实际软键盘下保存按钮、返回键与未保存草稿、前后台恢复。原生自动化需调试验收包；正式包另行执行验签、安装和启动检查。

短信权限受系统和安装渠道限制，当前仅侧载/模拟器验证；没有 Google Play 审核批准。权限拒绝不阻止备注粘贴。真实设备矩阵、APK 最终哈希与完整范围逐项结果见 IMPLEMENTATION_STATUS.md 和 DELIVERY_VERIFICATION.md。

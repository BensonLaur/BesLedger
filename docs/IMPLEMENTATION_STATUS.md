# 实施状态

更新：2026-10-22。已发布可安装 Android APK 与 Web/PWA 实施预览版，**完整第一版尚未完成**。剩余必要项是实际 OAuth 应用注册、用户授权及登录后的私有仓库/双端同步验收。采用本轮明确授权；本轮所有新增提交标题和正文均为中文。

## 阶段与验收

- [x] A：锁定依赖、领域模型、整数金额、期初边界、转账/借贷/退款、加密持久化、备份迁移与失败恢复。
- [x] B：正式 Vue 界面、短信确认、稳定分类排序、周期幂等、事件、日历/预算、统计与下钻、响应式/离线验证。
- [ ] C：真实应用 GitHub 授权、应用内独立私有仓库创建、发现与登录后的双端同步。
- [x] D（预览产物）：Web/PWA 部署、Android 专用长期签名、安装启动与覆盖升级、隐私检查和交付文档。

D 是可用的预览产物验收，不代表 C 可以省略。全量功能、实际设备及未覆盖范围见 [逐项验收记录](DELIVERY_VERIFICATION.md)。

## 已交付与验证

- Web/PWA：https://bensonlaur.github.io/BesLedger/。
- 预览版：https://github.com/BensonLaur/BesLedger/releases/tag/v0.1.0-preview.1。包含 APK、Web 生产 ZIP、SHA256SUMS.txt、signature.txt。
- 构建源码：863eb99629d505730679350d76642e78e2e08ced；APK 0.1.0 / versionCode 4，8,355,995 字节。全部阶段提交已推送。
- APK SHA-256：3d1a5bf3ef2ca6691e5a24d5e70f3280ae1ce040e32a571f781c5c5de30f1a1c。签名证书与本机专用公钥一致，v2 验签通过，非调试包。
- 核心自动化 27 项通过；真实私有仓库 API 集成另 1 项通过；三种浏览器/尺寸共 12 条端到端路径通过。
- Android API 36 模拟器：原生 SQLite、保存后杀进程重启、离线解锁、普通短信权限拒绝/授予/撤回、范围查询与勾选识别、软键盘和返回键草稿保护、前后台恢复通过。
- 最终发布包从同签名 versionCode 2 覆盖安装到 4，读回版本正确并冷启动正常。物理 Android/iPad 未接入，没有宣称真机通过。
- 云端 Web、原生编译、完整 lintDebug 和专用签名构建通过；npm audit 无已知漏洞。最终产物、Git 历史与公开内容隐私检查通过，演示数据均为虚构。

## 已核实环境

- 初始源码提交：32253d5db86e9c6873153d34842e916a2985b316；工作区初始干净。远端：https://github.com/BensonLaur/BesLedger.git。
- Node 24.15.0 / npm 11.12.1；Vue 3.5.44、Vite 7.3.7、TypeScript 5.9.3、Capacitor core/android/cli 8.4.3。完整精确版本见 package-lock.json。
- 独立 Microsoft JDK 21.0.12.1、Android SDK/API 36、build-tools 36.0.0；Gradle 8.14.3 / AGP 8.13.0。本机 Gradle 官方 ZIP 下载过慢，使用相同锁定配置的 GitHub Actions 实际构建，未改系统代理。
- Edge 155.0.4283.62（桌面与 Pixel 7 尺寸）、WebKit 27.2（iPad 尺寸）；API 36 x86_64 模拟器 / WebView 133.0.6943.137。
- 自建隔离 AVD：BesLedgerTestApi36，serial emulator-5556；工具在被忽略的 .tools/，不会改系统 Java/SDK 或操作真实设备。

## 已落实的工程决定

- 业务、短信解析、加密、本地适配和 GitHub 访问分层。账户余额与收支统计统一由整数金额记录投影；本金与利息作为同一业务原子保存。
- Web IndexedDB 与 Android SQLite 仅落盘加密空间及上一版本。口令封装和独立恢复材料分离，多个窗口保存执行版本比较，锁定期间异步回调不能重新解锁。
- 同步采用稳定身份、实体版本向量、SHA 比较写入及墓碑；并发同笔/删除冲突必须显式处理。周期期次 ID 稳定，独立生成与规则游标可收敛。
- 按账本同步，只携带被其引用的共用账户定义；不上传其他本地流水或余额投影，始终标注“本机已知范围”。密文快照 25 MB、完整备份 50 MB 上限明确失败，不截断；尚未做增量块/历史压缩。
- Web 发布目录 dist/，Android dist-android/ 不启用 PWA Service Worker；正式 APK 禁止系统自动备份，使用显式加密备份。
- Set.of 仅从 API 30 提供，已替换为 API 29 可用集合并通过完整 Lint；电话硬件为可选，不阻止无 SIM 设备安装。
- 专用 RSA-3072 发布签名位于 private/signing/，ACL 仅当前用户/SYSTEM，口令 Windows DPAPI 保护；同一材料安全配置在本仓库 Actions secrets。未发布私钥或口令，升级不得重建签名。

## 当前外部阻塞与继续入口

开发账号 BensonLaur 的 gh 可用，但浏览器 GitHub 注册入口未登录，尚未取得用户 OAuth App 的公开 Client ID；开发 gh 凭证不能替代应用登录。已向用户集中说明外部登录动作，其余可独立工作均已推进至预览发布。

需要用户在 GitHub 注册 BesLedger OAuth App、开启 Device Flow，并提供**公开 Client ID**（或完成浏览器登录后由实施者继续注册）；无需提供密码、2FA、Client Secret 或长期 token。准确网址及字段见 [DEPLOYMENT.md](DEPLOYMENT.md)。这属于外部账号登录/注册依赖，不是再次申请已经授予的 GitHub、私有仓库或发布权限。

已准备的线上授权服务：https://besledger-github-auth.bensonlaur.chatgpt.site。Sites project_id 为 appgprj_6ad8dc6c8aa0819194ac3849518bc2bd；保留既有项目，不重复创建。当前未配置 GITHUB_CLIENT_ID；生产 Pages 的浏览器跨域 POST 已实际返回预期 503/app_not_configured，证明跨域连通但不能当作授权成功。命令行请求受 Cloudflare 拦截，不代表浏览器调用结果。

取得 Client ID 后更新既有服务运行环境并重新部署，设置源码仓库变量 BESLEDGER_AUTH_SERVICE，再发布 Web/APK。随后必须用两个独立实际客户端存储完成真实授权、应用内私有仓库创建/选择与 private 读回、首次上传、发现下载、编辑回传、冲突、拒绝/失效/退出重连验收。

独立私有测试仓库 BensonLaur/BesLedger-Data-SyncTest-20261021 已实际创建并读回 private；仅含客户端加密的虚构测试账。现有真实 API 测试使用两个独立 Vault/fake-indexeddb 实例及开发凭证，证明同步协议，不冒充登录后的两台实际终端。

## 有效命令与恢复

- npm ci；npm test；npm run check；npm run build；npm run preview -- --port 4173。
- npm run test:e2e（需本机 Edge 与已安装 Playwright WebKit）；npm run android:sync。
- PowerShell 7：./scripts/build-android.ps1 -JavaDirectory <JDK绝对路径> -SdkDirectory <SDK绝对路径>；正式签名材料已存在，禁止再次生成覆盖。
- 原生验收入口：scripts/test-android.mjs、scripts/test-android-sms.mjs、scripts/test-android-lifecycle.mjs；须使用指定隔离模拟器与调试验收包。
- 文本检查：node scripts/text-format.mjs --check，只处理本批触及文件；gradlew 和 *.sh 按显式规则 LF，其余文本纯 CRLF。

继续时先看本文件、git status 和 DEPLOYMENT.md，不重新初始化、不重复创建 Site/签名/测试仓库。验收与部署证据见 DELIVERY_VERIFICATION.md；加密备份、恢复、账号与签名边界见 SECURITY_AND_RECOVERY.md。

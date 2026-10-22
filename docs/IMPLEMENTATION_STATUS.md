# 实施状态

更新：2026-10-22。已发布可安装 Android APK 与 Web/PWA 实施预览版，**完整第一版尚未完成**。正在按最新要求迁移到最小权限 GitHub App；旧 OAuth 的真实测试不能代替新方案验收。采用本轮明确授权；本轮所有新增提交标题和正文均为中文。

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

## 当前 GitHub App 迁移（2026-10-22）

用户要求改用平台强制限制仓库范围的 GitHub App，保持自动建库和安全登录保存。原 OAuth 方案的 repo 范围过大，不再作为最终交付方案。新注册、安装及撤销旧授权步骤见 GITHUB_APP_SETUP.md。公开 App 为 https://github.com/apps/besledger-sync，ID 5426577、Client ID Iv23liqKVYOk5K5MFB1j；已通过真实 API 核对三项最小权限。

- 本轮 OAuth 路径曾实际完成两套独立浏览器授权、应用内私有测试仓库创建、读回 private、首次上传、发现下载、修改回传、离线并发冲突、删除传播及显式恢复。
- 私有验收仓库：BensonLaur/BesLedger-Data-Acceptance-20261022，仅有本轮虚构加密数据。旧协议测试仓库 BensonLaur/BesLedger-Data-SyncTest-20261021 可作未选中仓库的权限负向验证，不能使用真实业务仓库测试越权。
- OAuth 的实际刷新、锁定、浏览器进程重启后登录恢复及真实 refresh token 轮换均已通过；这证明持久化机制，不证明最小权限方案已验收。
- Android v5 调试验收已通过 SQLite v1 数据文件迁移、原有余额与流水保留、虚构授权凭证的刷新/锁定/进程重启/离线恢复和主动退出。脚本 scripts/test-android-auth.mjs 为该验收入口。
- 当前源码主线 c6ea34d6236751faa9e6528632575318f6a713aa 已推送，Web 已部署；v5 签名 APK 已构建和验签（CB374850C5024490D9786118B307143957347B8E49C161680940C61AA7485AED），因权限迁移未发布新版 Release。
- 工作区已改为 GitHub App：只请求 offline_access；校验固定 App 身份、Only select repositories、最小三项权限、仓库名称/私有/本人归属；旧 OAuth 凭证升级即清除，不再调用全部私有仓库列表。
- GitHub App 核心测试 59 项通过，三类浏览器登录保持流程通过（模拟 App 响应）。真实 App 的两个独立 Edge 存储已完成用户 Device Flow 授权、应用内自动创建 BesLedger-Data-AppTest-20261022、读回私有与安装范围、首次上传、发现解密下载、修改回传、离线并发冲突、删除/编辑冲突、删除传播与显式恢复。
- 真实 GitHub App 用户令牌访问未选中的独立虚构私有仓库 BesLedger-Data-SyncTest-20261021 返回 404；应用仅列出安装中的专用仓库。没有测试任何无关业务仓库的文件。
- 真实 App 登录在刷新、锁定/解锁、浏览器进程关闭并离线重启后保留，联网同步成功。仅在隔离测试存储将到期元数据调早，实际 GitHub refresh 请求成功，访问令牌和刷新令牌均轮换并加密落盘。
- GitHub 页面要求 Only select repositories 至少选择一个现有仓库；已安装后自动建库不能代替首次零仓库流程证明。正在验证授权后、安装前的建库边界。Android v6 构建、最终 Pages 与 Release 仍待完成。
- 授权服务复用 https://besledger-github-auth.bensonlaur.chatgpt.site，project_id 为 appgprj_6ad8dc6c8aa0819194ac3849518bc2bd；v3 已成功发布，源码 886ae9fac46760b0ea285bb112d030299108b79c，环境 revision 3，固定为新 GitHub App 身份。

旧 OAuth 浏览器验收目录 private/oauth-acceptance/alpha、beta 已主动退出并关闭。新 App 验收目录 private/app-acceptance/alpha、beta 及临时测试恢复材料受当前 Windows 用户/SYSTEM ACL 保护且被忽略，未输出或入库。所有账目均虚构，禁止用真实财务文件补 fixture。

## 有效命令与恢复

- npm ci；npm test；npm run check；npm run build；npm run preview -- --port 4173。
- npm run test:e2e（需本机 Edge 与已安装 Playwright WebKit）；npm run android:sync。
- PowerShell 7：./scripts/build-android.ps1 -JavaDirectory <JDK绝对路径> -SdkDirectory <SDK绝对路径>；正式签名材料已存在，禁止再次生成覆盖。
- 原生验收入口：scripts/test-android.mjs、scripts/test-android-sms.mjs、scripts/test-android-lifecycle.mjs；须使用指定隔离模拟器与调试验收包。
- 文本检查：node scripts/text-format.mjs --check，只处理本批触及文件；gradlew 和 *.sh 按显式规则 LF，其余文本纯 CRLF。

继续时先看本文件、git status 和 DEPLOYMENT.md，不重新初始化、不重复创建 Site/签名/测试仓库。验收与部署证据见 DELIVERY_VERIFICATION.md；加密备份、恢复、账号与签名边界见 SECURITY_AND_RECOVERY.md。

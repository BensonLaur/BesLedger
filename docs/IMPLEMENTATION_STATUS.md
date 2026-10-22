# 实施状态

追加任务（2026-10-23）：Web/PWA 中转改用 Cloudflare Pages Functions，生产地址 https://besledger-github-auth.pages.dev。Vercel 因短信验证不可达取消；Cloudflare 账号已注册并授权，部署凭证由 Windows Credential Manager 保护。单独 Worker 已上传，但 workers.dev 在当前网络解析异常、连接超时，改为同账号免费的 Pages Functions。首次 Pages 部署 1697998a 已成功，当前网络匿名健康检查、固定 App 身份及三项跨域预检通过；65 项核心测试通过、1 项默认集成跳过，Wrangler 依赖审计 0 漏洞。仓库发布变量已切换，接下来发布新版 Web 并做真实浏览器授权、续期和同步，尚未以服务探针代替完整验收。

更新：2026-10-22。0.1.0 正式交付版已发布，必需功能和可用环境中的验收完成。Web/PWA 与长期签名 Android APK 可下载；真实 GitHub App 授权、自动私有建库、Web/Android 双向同步和安全保持登录通过。物理 Android/iPad 未接入，网络及设备边界见逐项验收记录。所有阶段提交标题和正文均为中文。

## 阶段与验收

- [x] A：锁定依赖、领域模型、整数金额、期初边界、转账/借贷/退款、加密持久化、备份迁移与失败恢复。
- [x] B：正式 Vue 界面、短信确认、稳定分类排序、周期幂等、事件、日历/预算、统计与下钻、响应式/离线验证。
- [x] C：真实 GitHub App 授权、应用内独立私有仓库创建、远端发现、两套浏览器及 Android 原生与 Web 双向同步。
- [x] D：Web/PWA 部署、Android 长期签名、安装启动与覆盖升级、隐私检查、版本发布和交付文档。

全量功能、实际设备、测试性质及剩余验证范围见 [逐项验收记录](DELIVERY_VERIFICATION.md)。物理设备未接入不冒充真机通过。

## 当前交付物

- [Web/PWA](https://bensonlaur.github.io/BesLedger/)。
- [0.1.0 正式版本](https://github.com/BensonLaur/BesLedger/releases/tag/v0.1.0)：APK、Web 生产 ZIP、SHA256SUMS.txt、signature.txt；旧 preview.1 只保留历史。
- 构建源码：8b3e5587b51ff602a4011226e024d8fc3f471b2c。APK 0.1.0 / versionCode 8，8,364,607 字节，Android 10/API 29 起、target 36。
- APK SHA-256：63b6f1c06d6ed47bb7b4f9a9aeff5e1b651956e3891e821583809cd4f06a1e3e。
- Web ZIP：199,210 字节；SHA-256 3b950318d56f21cfeece43964dd748f24915907bf9253ea50f931b4c33af7059。
- 发布后 GitHub 资产大小与 digest 均与本机一致。相同附件在 artifacts/v8-final/，Web CI 目录为 artifacts/v8-web/，均被忽略。
- 专用 RSA-3072、APK v2 验签通过、无 DEBUGGABLE。证书 SHA-256：b54b12f342a892713a8764ae2544e68de234309a266e7a70c6fba87000a22716。

## 已完成的验证

- 核心 Vitest 63 项通过，默认真实集成入口 1 项跳过；12 条浏览器主要流程和 3 条授权流程通过。后者模拟 GitHub 响应，真实授权另行验收，不混淆证据。
- 两套独立 Edge 存储真实 GitHub App Device Flow 登录，私有建库、首次上传、发现下载、修改回传、离线并发冲突、删除/编辑冲突、删除传播与显式恢复通过。
- All repositories 实际自动创建 BesLedger-Data（private，ID 1429836113），标记及重复准备复用通过。Android 新客户端登录后自动发现，不输入名称。
- Android API 36 实际 SQLite 与独立 Web 浏览器双向修改虚构流水收敛；原生直接向 GitHub 取得设备码、换取令牌和实际续期，访问及刷新令牌均轮换并加密落盘。
- 浏览器与原生刷新、锁定/解锁、杀进程后断网重启保留登录；联网同步恢复。主动退出清除可用凭证且不会被迟到刷新复活。保持登录不绕过本地解锁口令。
- 原生 SQLite v1 到 v2 数据迁移及旧流水保留、普通短信权限拒绝/授予/撤回、范围查询与勾选识别、软键盘保存、返回键草稿保护和前后台恢复通过。
- 最终非调试 APK 在隔离模拟器从同签名 versionCode 7 覆盖安装到 8，读回版本、冷启动和进程正常。此安装检查与原生调试包的业务验收分开记录。
- 发布源码的签名构建 39796038326、Web/Android/完整 lintDebug 39796037179、Pages 39796036860 均成功。线上 Web 启动与 390 像素布局复核通过。
- APK 457 个及 Web ZIP 15 个归档条目通过凭证精确匹配、私钥/令牌模式、禁止文件类型及源码映射检查。全部账目、短信和验收截图为虚构，未导入真实财务数据。依赖审计此前无已知漏洞，依赖未改动。

## 已核实环境

- 源码：https://github.com/BensonLaur/BesLedger；master 分支，无强制推送或历史改写。
- Node 24.15.0 / npm 11.12.1；Vue 3.5.44、Vite 7.3.7、TypeScript 5.9.3、Capacitor 8.4.3。精确版本见 package-lock.json。
- 独立 Microsoft JDK 21.0.12.1、Android SDK/API 36、build-tools 36.0.0；Gradle 8.14.3 / AGP 8.13.0。本机 Gradle 下载过慢，使用相同锁定组合的 GitHub Actions 实际构建，未改系统代理。
- Edge 155.0.4283.62（桌面与 Pixel 7 尺寸）、WebKit 27.2（iPad 尺寸）；API 36 x86_64 模拟器 / WebView 133.0.6943.137。
- 自建隔离 AVD：BesLedgerTestApi36，serial emulator-5556；工具位于被忽略的 .tools/。物理 Android/iPad 未接入。

## 已落实的工程决定

- 业务、短信解析、加密、本地适配和 GitHub 访问分层；金额使用整数，本金与利息作为同一业务原子保存。
- Web IndexedDB 与 Android SQLite 保存密文空间及上一版本；解锁后构建内存投影。并发保存版本比较，数据库升级不删库重建。
- 登录凭证由主密钥通过 HKDF 派生独立 AES-GCM 密钥加密，保存在独立数据库/表；不进入账本、备份和云端。离线恢复身份、网络错误保留登录、真实失效才要求重登；Web Locks 与凭证 CAS 防止轮换竞争和退出复活。
- 同步使用稳定身份、实体版本向量、SHA 比较写入及墓碑；同笔/删除冲突显式处理。周期期次身份稳定，重复生成与规则游标可收敛。
- 仅同步所选账本和引用账户定义，不上传其他仅本地流水或余额投影；显示本机已知范围。单本密文 25 MB、完整备份 50 MB 上限明确失败，不截断；尚无增量块/历史压缩。
- Web 输出 dist/；Android 输出 dist-android/，不注册 PWA Service Worker。Android 禁止系统自动备份，提供显式加密备份。
- API 29 兼容集合与完整 Lint 通过；电话硬件可选。短信权限依赖系统和分发，拒绝后仍可粘贴，不宣称 Google Play 审核批准。
- 长期签名位于 private/signing/，ACL 仅当前用户/SYSTEM，口令使用 Windows DPAPI；同一材料配置在本仓库 Actions secrets。升级禁止重新生成签名。

## GitHub App 决策与真实边界

用户先要求专用仓库隔离，随后明确选择 All repositories，已在安装 174137690 保存。最新授权替代早先范围要求。App 仅 Contents 写入、Repository creation 写入、Metadata 只读；不恢复旧 OAuth repo、不申请 Administration。此令牌仍可读写其他及未来仓库内容；应用代码的限制和开源不等于平台隔离。

公开 App：https://github.com/apps/besledger-sync；App ID 5426577、Client ID Iv23liqKVYOk5K5MFB1j。普通用户无需注册应用。仅请求 offline_access，不需要 Client Secret 或 App 私钥。用户已明确确认撤销旧 BesLedger OAuth 授权，新版不使用旧格式凭证。

- 历史 selected 模式：必须先有一个仓库才能安装；未安装时真实建库返回 403。安装后可自动建库并获得新库访问。未选中的虚构私有测试仓库返回 404；卸载/重装后身份授权仍有效。
- 当前 All 模式：上述未选中虚构仓库元数据返回 200，范围扩大已核实；没有读取无关业务仓库文件。正常流程安装、登录后自动准备存储，不输入名称。只查询稳定候选和已有绑定，不枚举账号全部仓库。
- 使用绑定仓库 ID/owner ID 的专用标记或旧加密目录识别存储，不依赖名称前缀。同名未知用途或公开仓库不覆盖；已有绑定不可见时不切换成新空库。
- 本轮默认仓库中的新建虚构验收账本已按身份、私有性和 SHA 校验后清理，GET 确认 404；保留私有仓库、README 和标记供正常使用。其他独立虚构测试仓库保留，Git 历史密文不宣称擦除。测试客户端均主动退出。

Web 授权中转复用 https://besledger-github-auth.bensonlaur.chatgpt.site，project_id appgprj_6ad8dc6c8aa0819194ac3849518bc2bd；v3 部署成功，服务源码 886ae9fac46760b0ea285bb112d030299108b79c，环境 revision 3。当前桌面浏览器真实授权通过，但模拟器直连网络被托管边缘 403/CORS 拦截；versionCode 8 改用 CapacitorHttp 直连 GitHub并关闭桥接参数日志，实际授权与续期通过。Web/PWA 仍有中转可达性限制，见 DEPLOYMENT.md；未更换请求身份或修改系统代理绕过限制。

## 有效命令与后续维护

- npm ci；npm test；npm run check；npm run build；npm run preview -- --port 4173。
- npm run test:e2e（本机 Edge 和已安装 Playwright WebKit）；npm run test:auth；npm run android:sync。
- PowerShell 7：./scripts/build-android.ps1 -JavaDirectory <JDK绝对路径> -SdkDirectory <SDK绝对路径>；正式签名材料已存在，禁止覆盖。
- 原生脚本：scripts/test-android.mjs、scripts/test-android-auth.mjs、scripts/test-android-sms.mjs、scripts/test-android-lifecycle.mjs。仅用于指定隔离模拟器与调试包，auth 脚本的虚构凭证不能冒充真实授权。
- 文本检查：node scripts/text-format.mjs --check；只处理本批触及文件，gradlew 和 *.sh 为 LF，其余文本纯 CRLF。

后续按真实手机/iPad、更多银行模板和实际补账体验反馈迭代；不重新初始化、重复创建 Site/签名或恢复旧 OAuth。恢复和签名备份见 SECURITY_AND_RECOVERY.md；当前测试恢复材料在被忽略且有 ACL 的 private/app-acceptance/，不得公开。

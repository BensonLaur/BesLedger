# 实施状态

## 0.1.3 完整交付

统一采用钱包图标并恢复原型日历三面效果，原型和正式应用同步更新；本地记账、登录保持及手动同步行为保持。73 项核心、33 条浏览器流程、签名覆盖安装和原生数据保持检查通过。当前下载统一为 [0.1.3](https://github.com/BensonLaur/BesLedger/releases/tag/v0.1.3)，验证与真机边界见 [逐项验收](DELIVERY_VERIFICATION.md)。

## 0.1.2 统一交付

2026-10-23：原型与正式应用统一改进五项导航、账户创建、分类图标、记账键盘和“我的”分组/连接状态，保留已有登录与同步能力。工程、浏览器和 API 36 原生验证及签名覆盖升级结果见 [本轮验收](DELIVERY_VERIFICATION.md#012-统一界面与登录同步交付2026-10-23)。该次版本入口：[0.1.2](https://github.com/BensonLaur/BesLedger/releases/tag/v0.1.2)，旧发布转入 [历史归档](RELEASE_ARCHIVE.md)。

以下保留原 0.1.1 与早期实施记录，作为技术追溯，不代表当前下载版本。


已完成（2026-10-23，0.1.1）：首次上传自动使用本机密钥，外部账本首次下载验证后安全记住；按账号/仓库/账本绑定的 HKDF + AES-GCM 密文存入本机归档，不进入导出备份和云端。锁定/恢复后的迟到请求、错误替换、跨窗口 CAS、忘记后不复活及旧归档兼容测试通过。当前核心 73 项、浏览器 18 条流程通过；新增案例验证先有本地账户与流水，再登录、下载另一云端账本，原数据保留且不自动上传，显式首次上传后才新增远端副本。

Android 0.1.1 / versionCode 9 已使用原长期签名构建并验签，与正式预览包及 0.1.0 同证书。GitHub Actions 39825782728 的 API 36 隔离模拟器实际运行 WebView/SQLite，验证密钥加密落盘、页面返回、锁定解锁、杀进程重启后不重新输入、忘记密钥保留账目。GitHub API/登录会话在此新增原生测试中明确模拟；真实 GitHub 授权协议的既有证据保持独立。本机模拟器启动曾被自动审批拒绝，已通过远端隔离环境完成替代验证。

应用构建源码 c936b4d4b84ea75b4d1227c465e11d9a405859d1；签名构建 39825782076、Web/Android/Lint/原生验证 39825782728、Pages 39825782775 均成功。正式与 Cloudflare 备用 Web 已核对相同 0.1.1 产物，备用部署 38f53acd。最新下载见 v0.1.1；下方 0.1.0 和 web-20261023 保留为历史记录，不作为当前升级入口。

追加任务（2026-10-23）已完成真实验收：Web/PWA 中转为 https://besledger-github-auth.pages.dev，免费 Cloudflare Pages Functions 统一提供服务，普通用户无需托管账号、手机号验证、部署或配置地址。Vercel 因短信验证不可达取消；单独 Worker 的 workers.dev 在当前网络解析异常，因此使用 pages.dev。部署凭证由 Windows Credential Manager 保护，只授予用户/账号读取、Workers 脚本和 Pages 管理。

两套独立 Edge 存储从公开 Cloudflare Web 通过新中转真实登录，自动准备既有私有存储，完成虚构账目上传、发现下载和双向修改（21.23 → 22.34 → 23.45）。仅将隔离测试凭证的到期元数据提前，实际调用生产 /refresh 后访问与刷新令牌均轮换并加密落盘。锁定/解锁、关闭浏览器进程后离线重开、联网再次同步、线上 PWA 更新后保持登录、主动退出后刷新不复活均通过。本轮云端文件经过仓库身份、私有性、标记、账本名称与 SHA 校验后清理，读回 404；仓库和标记保留，两个客户端均已退出并关闭。

当前 66 项核心测试通过、1 项真实集成入口默认跳过；12 条主要浏览器流程与 3 条模拟授权流程重新通过。首次未受 Service Worker 控制的页面更新不刷新的问题已修复，真实 Worker 验证更新后本地加密账本保留。CI 发现一个既有篡改测试以固定字符替换随机首字符的偶发误判，现已改为翻转字节，并阻止失败断言输出临时测试密钥；该次失败日志已清理，生产加密格式未改。Wrangler 依赖审计 0 漏洞。

最终代码 fc6b3a6 的 Pages 39819827133、Web/Android/完整 Lint 39819827294 均成功；正式网址与 Cloudflare 备用网址已发布相同生产应用，新中转已内置。

更新：2026-10-22。0.1.0 正式交付版已发布，必需功能和可用环境中的验收完成。Web/PWA 与长期签名 Android APK 可下载；真实 GitHub App 授权、自动私有建库、Web/Android 双向同步和安全保持登录通过。物理 Android/iPad 未接入，网络及设备边界见逐项验收记录。所有阶段提交标题和正文均为中文。

## 阶段与验收

- [x] A：锁定依赖、领域模型、整数金额、期初边界、转账/借贷/退款、加密持久化、备份迁移与失败恢复。
- [x] B：正式 Vue 界面、短信确认、稳定分类排序、周期幂等、事件、日历/预算、统计与下钻、响应式/离线验证。
- [x] C：真实 GitHub App 授权、应用内独立私有仓库创建、远端发现、两套浏览器及 Android 原生与 Web 双向同步。
- [x] D：Web/PWA 部署、Android 长期签名、安装启动与覆盖升级、隐私检查、版本发布和交付文档。

全量功能、实际设备、测试性质及剩余验证范围见 [逐项验收记录](DELIVERY_VERIFICATION.md)。物理设备未接入不冒充真机通过。

## 当前交付物

- [Web/PWA](https://bensonlaur.github.io/BesLedger/)。
- [Cloudflare 备用 Web/PWA](https://besledger-bensonlaur.pages.dev/BesLedger/) 与 [2026-10-23 Web 更新包](RELEASE_ARCHIVE.md)。两个来源的本地存储互相独立；已有用户继续原网址更新，换网址需加密备份或同步恢复。
- 最新 Web 包 BesLedger-web-20261023-pwa.zip：199,202 字节，SHA-256 1fe4f0fd9614696f8c39911e23e8f8d909bb8c4d29a14eaa17a57974418166a9；应用构建源码 dc338f9fe9d683c1f8657a3e96a02b7167bed147。Cloudflare Web 部署 be5c84a1，中转含双来源配置的部署 9dcc341b。15 个产物条目已检查，无实际凭证、私钥或源码映射。
- [0.1.0 正式版本](RELEASE_ARCHIVE.md)：APK、Web 生产 ZIP、SHA256SUMS.txt、signature.txt；旧 preview.1 只保留历史。
- 构建源码：8b3e5587b51ff602a4011226e024d8fc3f471b2c。APK 0.1.0 / versionCode 8，8,364,607 字节，Android 10/API 29 起、target 36。
- APK SHA-256：63b6f1c06d6ed47bb7b4f9a9aeff5e1b651956e3891e821583809cd4f06a1e3e。
- 原 0.1.0 Web ZIP：199,210 字节；SHA-256 3b950318d56f21cfeece43964dd748f24915907bf9253ea50f931b4c33af7059。仅保留原发布记录，Web 下载使用上方更新包。
- 发布后 GitHub 资产大小与 digest 均与本机一致。相同附件在 artifacts/v8-final/，Web CI 目录为 artifacts/v8-web/，均被忽略。
- 专用 RSA-3072、APK v2 验签通过、无 DEBUGGABLE。证书 SHA-256：b54b12f342a892713a8764ae2544e68de234309a266e7a70c6fba87000a22716。

## 已完成的验证

- 原 0.1.0 首次交付时核心 Vitest 63 项通过，默认真实集成入口 1 项跳过；12 条浏览器主要流程和 3 条授权流程通过。当前新增的中转检查与重新验收结果见本文开头；模拟授权与真实授权证据不混淆。
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

历史 Web 中转为 https://besledger-github-auth.bensonlaur.chatgpt.site，project_id appgprj_6ad8dc6c8aa0819194ac3849518bc2bd；v3 部署源码 886ae9fac46760b0ea285bb112d030299108b79c、环境 revision 3。它曾在桌面通过、在其他网络被边缘 403/CORS 拦截。当前 Web 已统一切换本文开头的 Cloudflare Pages Functions；旧站不自动回退。Android versionCode 8 保持 CapacitorHttp 直连 GitHub，桥接参数日志关闭。没有修改系统代理、DNS 或伪造请求身份绕过拦截。

## 有效命令与后续维护

- npm ci；npm test；npm run check；npm run build；npm run preview -- --port 4173。
- npm run test:e2e（本机 Edge 和已安装 Playwright WebKit）；npm run test:auth；npm run android:sync。
- PowerShell 7：./scripts/build-android.ps1 -JavaDirectory <JDK绝对路径> -SdkDirectory <SDK绝对路径>；正式签名材料已存在，禁止覆盖。
- 原生脚本：scripts/test-android.mjs、scripts/test-android-auth.mjs、scripts/test-android-sms.mjs、scripts/test-android-lifecycle.mjs。仅用于指定隔离模拟器与调试包，auth 脚本的虚构凭证不能冒充真实授权。
- 文本检查：node scripts/text-format.mjs --check；只处理本批触及文件，gradlew 和 *.sh 为 LF，其余文本纯 CRLF。

后续按真实手机/iPad、更多银行模板和实际补账体验反馈迭代；不重新初始化、重复创建 Site/签名或恢复旧 OAuth。恢复和签名备份见 SECURITY_AND_RECOVERY.md；当前测试恢复材料在被忽略且有 ACL 的 private/app-acceptance/，不得公开。

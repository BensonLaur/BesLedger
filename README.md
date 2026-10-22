# BesLedger · Bes记账

先为自己做一本顺手的账：复制银行交易短信，粘贴后识别分类、资金账户、金额和交易时间，确认后保存。

BesLedger 是 Bes 系列的个人记账项目。作者已经习惯挖财记账，日常消费尽量集中通过一张银行卡支付，并利用银行交易短信隔几天集中补账。本项目优先减少逐笔选择账户、输入金额和调整日期时间的操作；项目以 MIT 协议开源；收到真实用户反馈后，再考虑扩展其他常见功能。

## 当前阶段

正式 Vue/TypeScript 应用 0.1.0 已交付：本地加密账本、共用账户、收支/转账/借贷、短信确认、退款、周期账、日历预算、统计和备份恢复已实现。66 项核心测试、三种引擎/尺寸的 12 条主要流程与 3 条授权流程通过；真实 GitHub App 登录、自动私有建库、跨端同步和登录续期通过。

打开 [Web/PWA](https://bensonlaur.github.io/BesLedger/)，或下载 [Android APK](https://github.com/BensonLaur/BesLedger/releases/download/v0.1.0/BesLedger-0.1.0-release.apk)（Android 10 起）。[0.1.0 版本页](https://github.com/BensonLaur/BesLedger/releases/tag/v0.1.0) 提供专用长期签名 APK、Web 生产包及 SHA-256。Android versionCode 8 已验签，并在 API 36 模拟器从同签名 versionCode 7 覆盖升级、冷启动；完整 Lint 通过。

2026-10-23 的 [Web/PWA 更新包](https://github.com/BensonLaur/BesLedger/releases/tag/web-20261023) 已内置免费的 Cloudflare 登录中转，并修复首次 PWA 更新；Web 下载请使用该更新包，Android APK 保持上述版本。另有 [Cloudflare 备用 Web/PWA](https://besledger-bensonlaur.pages.dev/BesLedger/)。两个网址的本地存储相互独立；已有账目请继续使用原网址，需要迁移时使用加密备份或同步恢复密钥，不要清除原站点数据。

GitHub 同步可选。普通用户无需注册 App，也无需手工建库或输入仓库名：安装 BesLedger Sync 并登录后，应用自动准备私有存储，再选择需要同步的账本。刷新、重启和锁定后保留加密登录，令牌到期自动续期；本地账本仍需解锁，主动退出会清除本机登录。

默认安装选择 **All repositories**，令牌具备其他及未来仓库内容的读写能力。当前代码只使用确认过的账本存储，应用行为限制不等同平台隔离；也可自行选择 selected 范围，但首次须已有专用仓库。Android 原生端与 Web 的真实双向同步已通过；物理 Android/iPad 尚未接入。Web 登录中转由维护者统一提供，普通用户不需要托管账号、部署或填写地址；新服务的真实登录、续期、双向同步和离线重开保持登录已验证。Android 直接连接 GitHub。产物和设备证据见 [逐项验收](docs/DELIVERY_VERIFICATION.md)，维护者配置见 [部署说明](docs/DEPLOYMENT.md)。

## 开始使用

1. 创建本地账本并设置解锁口令；独立保存恢复密钥，然后建立账户及期初金额。
2. 在“记一笔”的备注中粘贴短信，核对识别结果后保存。本地记账无需 GitHub。
3. 需要同步时，进入 GitHub 连接，点击“在 GitHub 安装同步应用”，选择自己的账号及安装范围；返回应用点击“使用 GitHub 登录”，按页面设备码完成授权。
4. 应用自动准备云端私有存储。备份恢复密钥后，选择账本首次上传；另一设备登录后，输入原设备的同步恢复密钥，解密下载。

保留完整加密备份和恢复密钥；同步不能替代独立备份。手机安装或浏览器使用问题可结合 [安全与恢复说明](docs/SECURITY_AND_RECOVERY.md) 排查。

## 开发与构建

需要 Node 24 LTS。以下命令已实际运行：

```powershell
npm ci
npm test
npm run check
npm run dev
npm run build
npm run preview -- --port 4173
npm run test:e2e -- --project=desktop --project=android-layout
```

Web 访问 `/BesLedger/` 子路径，产物在 `dist/`；Android 使用 `dist-android/`，避免两个构建相互覆盖。PWA 首次完成资源缓存后可离线打开。浏览器测试使用本机 Edge；WebKit 项目需安装对应 Playwright 浏览器。

```powershell
npm run android:sync
# 使用 PowerShell 7，传入独立 JDK 21 与 Android SDK 的绝对路径
./scripts/build-android.ps1 -JavaDirectory <JDK目录> -SdkDirectory <SDK目录>
```

首次维护者发布需运行 `scripts/create-signing.ps1` 生成专用签名；已有签名禁止覆盖。详见 [安全与恢复](docs/SECURITY_AND_RECOVERY.md)。生产授权服务地址通过 `VITE_AUTH_SERVICE` 配置；应用注册缺失时不会模拟登录成功。

## 首要使用场景

1. 从短信应用复制一条银行交易通知，直接粘贴到记账页的备注。
2. 预填分类、资金账户、交易金额和交易时间，并保留原文供核对。
3. 区分明确识别、推断候选与缺失信息；对年份、账户歧义和未知分类给出简短提示。
4. 用户确认或修正后保存，再继续粘贴下一条短信。

目标是让常见格式、已配置账户和商家规则的单条短信，尽可能在约 10 秒内完成录入；这是待实机验证的体验目标，不是当前已经达到的指标。

## 初步技术方向

- Vue 3、TypeScript、Vite：共享 Web/PWA 界面，以 Capacitor 8 构建 Android APK；兼顾 iPad 网页。
- IndexedDB、Dexie.js：本地保存数据；记账操作先在本机完成。
- GitHub 私有仓库：作为可选的加密同步存储；本地使用不强制登录。
- Web Crypto：封装加密、密钥恢复和完整性校验。
- 独立的业务、短信解析、存储与同步模块：具体选型边界见技术决策文档。

## 项目文档

| 文档 | 内容 |
| --- | --- |
| [产品定位](docs/PRODUCT.md) | 为谁解决什么问题、优先场景和范围 |
| [产品设计草案](docs/PRODUCT_DESIGN.md) | 页面流程、共用账户、基础借贷、统计与待确定细节 |
| [内置分类与排序](docs/CATEGORIES.md) | 通用分类清单、默认快捷项、固定“全部”入口和频率排序建议 |
| [技术栈决策](docs/TECH_STACK.md) | 技术基线、取舍、存储与授权边界 |
| [首页设计](docs/HOME_DESIGN.md) | 轻立体日历、明细联动、预算与新建账单时间 |
| [UI 源码快照](docs/prototypes/README.md) | 已确认页面的设计参考与原型边界 |
| [完整交付范围](docs/DELIVERY_SCOPE.md) | Web、Android、GitHub 登录与同步的验收标准 |
| [新会话执行任务](docs/EXECUTION_PROMPT.md) | 持续实施的完整目标、工程默认值和交付要求 |
| [短信录入流程](docs/SMS_WORKFLOW.md) | 四项核心识别信息、日期推断、分类和账户规则 |
| [短信访问边界](docs/SMS_ACCESS.md) | 粘贴与原生读取、法规依据、平台权限与分发条件 |
| [挖财导出结构](docs/WACAI_EXPORT.md) | XLSX 实测字段、借贷利息拆分、退款与迁移缺失信息 |
| [退款与周期记账](docs/REFUNDS_AND_RECURRING.md) | 挖财调研、已确认个人需求和暂缓的批量调整 |
| [同步模型](docs/SYNC_MODEL.md) | 唯一账本身份、四种主状态和异常处理 |
| [实施计划](docs/IMPLEMENTATION_PLAN.md) | 当前完成情况、后续阶段及验收方式 |
| [参考资料](docs/REFERENCES.md) | 挖财功能说明与技术官方文档 |
| [虚构短信样例](docs/examples/sms-recognition-cases.json) | 后续解析器的输入与预期行为草案 |

## 数据与许可

代码和原创文档采用 [MIT License](LICENSE)，沿用 BesFuel、BesMapLab、BesTools 的许可方式，版权署名为 BensonLaur。

真实账本、原始银行短信、截图、访问令牌和解密密钥不属于项目示例。私有调试资料放在已忽略的 `private/` 中；文档与公开样例只使用虚构数据。挖财的帮助文档、商标和界面素材仍归原权利人所有，功能参考不代表素材复制授权。

公开源码仓库、静态应用发布文件与用户的私有账本数据仓库分开管理。

# 实施状态

更新：2026-10-21。当前处于实际实施，未完成整体验收。采用本轮明确授权；后续提交标题和正文使用中文。

## 阶段与验收

- [ ] A：锁定依赖、领域模型、整数金额、期初边界、转账/借贷/退款、加密持久化、备份迁移与失败恢复。
- [ ] B：正式 Vue 界面、短信确认、稳定分类排序、周期幂等、事件、日历/预算、统计与下钻、响应式/离线验证。
- [ ] C：真实应用 GitHub 授权、独立私有仓库、客户端加密、发现与双端同步、冲突/删除/响应丢失验证。
- [ ] D：Web/PWA 部署、Android 发布构建与长期签名、安装运行、隐私检查和交付文档。

## 已核实环境

- 初始源码提交：32253d5db86e9c6873153d34842e916a2985b316；工作区初始干净。
- Node 24.15.0、npm 11.12.1；开发账号 BensonLaur 的 gh 可用。此登录不是应用内登录。
- 源码远端：https://github.com/BensonLaur/BesLedger.git。
- 已阅读执行正文与交付基线；演示数据均为虚构。
- 尚未确认独立 JDK/Android SDK、模拟器和真机。

## 当前工程决定

- 本地加密先于真实落盘：随机主密钥、口令派生封装、独立恢复材料，解锁密钥仅在内存；数据库只保存密文与非财务版本元数据。
- 本金与利息保存在同一业务操作中，账户投影与统计纯计算，避免半笔事务。
- 保留删除标记和稳定周期期次 ID；冲突不按时间戳静默覆盖。
- 按账本同步，账户仅传递被选账本引用的定义；不上传其他本地账本的流水或余额投影。余额明确标注本机数据范围。
- Web 按用户指定部署到 GitHub Pages；Android 与 Web 复用领域层，原生存储另适配。

## 当前工作与阻塞

进行依赖兼容核对与 A 阶段实现。GitHub 应用注册、授权服务与设备接入尚待实际检查；没有把它们记为完成。

## 恢复入口

继续当前工作区，先看本文件与 git status，不重新初始化。新增有效命令、测试证据、部署地址和剩余项随各阶段更新。
## 2026-10-21 实施进展

- 已实现正式 Vue 应用、加密本地空间、账本/共用账户、收支转账借贷、退款、周期/事件、短信确认、分类排序、日历预算、统计下钻及备份恢复。
- 19 项 Vitest 测试通过；严格 TypeScript 检查和 Web/PWA 生产构建通过；npm audit 全部依赖 0 漏洞。
- Edge 桌面和 Pixel 7 尺寸模拟：短信确认/日期保留、创建账户、保存/编辑、主要页面、无横向溢出、生产子路径和离线重新解锁均通过。
- 已修复实际浏览器发现的响应式 Proxy 无法 structuredClone 问题。截图仅含虚构测试账。
- 已创建 Android 工程（min 29 / compile/target 36），编写原生 SQLite 密文存储、短信范围查询和发布签名配置，尚未构建验证。
- 安全修复版本组合：Capacitor core/android/cli 8.4.3、Vue 3.5.44、Vite 7.3.7、Vitest 5.0.5、TypeScript 5.x；精确依赖见 package-lock.json。8.5.3 CLI 带入 iOS xcode/uuid 审计问题，本轮不交付 iOS，选用同样含 Android 修复的 8.4.3。
- 最小 OAuth Device Flow 中转服务代码和隔离测试已准备。Sites project_id：appgprj_6ad8dc6c8aa0819194ac3849518bc2bd；源码包在被忽略的 .cache/relay-site；注册配置见 services/auth-relay/hosting.json。不得再次创建同名 Site。
- GitHub 浏览器入口处于未登录状态，OAuth App 注册与用户实际授权尚未完成。中转服务没有 client ID，不能宣称登录成功。
- Android SDK tools 已校验下载；JDK GitHub 下载过慢，改走 Microsoft 官方 CDN，独立安装在 .tools，正在下载/校验。系统 JRE 未改动。
- 浏览器批量下载慢，先复用本机 Edge；WebKit/iPad、真实 Android/iPad 与模拟器尚未验证。

有效命令：npm ci；npm test；npm run check；npm run build；npm run preview -- --port 4173；npm run test:e2e -- --project=desktop --project=android-layout；node scripts/text-format.mjs --check。

当前下一步：完成授权服务发布、Android 构建/签名、扩展端到端业务测试、真实 GitHub 私有测试仓库集成与部署。尚未创建主仓库阶段提交或推送，不要把上述实现视为完整第一版验收完成。
## 最新验证补充

- 独立私有测试仓库 BensonLaur/BesLedger-Data-SyncTest-20261021 已创建并读回确认 private；只上传客户端加密的虚构账目。
- 真实 GitHub API 集成 1 项完整流程通过（41 秒）：两套隔离的加密存储、发现/下载、双向编辑、同笔冲突选择、删除传播及显式恢复。测试凭证来自开发 gh，仅证明协议与真实 API；未冒充应用内 OAuth 登录验收。
- Sites 授权服务版本 1 已部署成功：https://besledger-github-auth.bensonlaur.chatgpt.site。浏览器健康检查返回 configured=false；缺少 OAuth App client ID。命令行访问受 Cloudflare 拦截，后续须验证实际浏览器和 APK 跨域请求。
- 专用 RSA-3072 发布签名已生成；private/signing 仅当前用户/SYSTEM 可访问，口令 DPAPI 加密。无签名秘密进入源码/日志。
- Microsoft JDK 21.0.12.1 已下载并核对官方 SHA-256；Android SDK 36/build-tools 36.0.0、模拟器及 API 36 系统镜像已安装。修正了命令行工具多嵌套一层导致 avdmanager 找不到镜像的问题。
- Android Web 资源构建与 cap sync 通过；Gradle 8.14.3 正在官方网络下载，完整原生编译未结束。
- WebKit/iPad 尺寸的主要页面、保存编辑、离线重开已通过；时间值断言调整以接受浏览器保留零秒的标准差异，正在复验短信路径。
- GitHub Pages 已配置 workflow 发布模式，正式地址 https://bensonlaur.github.io/BesLedger/，尚未完成首次部署。
## 阶段提交与发布

- 主仓库阶段提交 907cd8f3b5ffe757daa72003283ca633f5823b87 已推送，标题与正文为中文，署名取自规定脚本实际输出。
- GitHub Actions 的 Web 与 Android 构建验证均成功；Android 编译成功产物目前是明确标注的调试验收包，正式长期签名构建继续进行。
- GitHub Pages 首次发布成功并读取验证 HTML，地址：https://bensonlaur.github.io/BesLedger/。当前尚未配置应用内 GitHub OAuth，不能宣布完整第一版完成。
- WebKit iPad 尺寸短信复验通过；三种浏览器/尺寸共 6 条端到端路径已分别通过。
- Android API 36 模拟器已启动且 boot_completed=1；真实物理设备仍未接入。
- GitHub Actions 专用签名 secrets 已安全配置于 BesLedger 源码仓库，仅用于本项目发布流程。未将签名文件或口令写入 Git。
## 2026-10-22 原生验收进展

- Android API 36 / WebView 133 模拟器：使用 scripts/test-android.mjs 通过原生 SQLite 保存、账户起算、记账、杀进程重启、断网解锁与余额一致验证。
- 已生成并验签专用发布 APK，证书 SHA-256 为 b54b12f342a892713a8764ae2544e68de234309a266e7a70c6fba87000a22716，与本机专用签名证书一致。最终文件哈希将在原生修复复验后更新。
- 短信运行时拒绝、再次普通授权已实际验证；测试发现 Capacitor getDouble 不接受 JSON Long 毫秒时间戳，导致正常筛选范围被拒绝，已修正并继续构建复验，不能暂称短信读取完整通过。
- SDK 安装路径已校正，模拟器已正常启动。原生发布在 GitHub Actions 使用相同锁定版本构建通过；本机 Gradle 官方 ZIP 下载异常缓慢，停止冗余下载，未改动系统代理或安全设置。
- 目前 24 项核心测试、6 项浏览器端到端测试通过；新增锁定期间保存回调不得重新解锁的生命周期测试。

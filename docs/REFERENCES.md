# 功能与技术参考

整理日期：2026-10-21。链接在当前需求讨论中已查阅；后续实现时按具体主题重新核对适用版本、权限和平台行为。

## 挖财官方帮助

用户明确指定：后续打磨某个功能时，挖财的功能说明可以作为参考。它帮助理解作者已有使用习惯，不自动转化成 BesLedger 的功能承诺。

| 主题 | 官方资料 |
| --- | --- |
| 首页、账本选择及账本服务 | [首页常用功能](https://jz.wacaijizhang.com/guide/question/function.html) |
| 账户类型、余额和资产管理 | [资产管理](https://jz.wacaijizhang.com/guide/account/account.html) |
| 大类、小类与类别调整 | [类别管理](https://jz.wacaijizhang.com/guide/category/category.html) |
| 信用卡与借贷到期提醒 | [计划管理](https://jz.wacaijizhang.com/guide/plan/plan.html) |
| 报表和全部账本汇总 | [报表说明](https://jz.wacaijizhang.com/guide/report/report.html) |
| 首页模块 | [首页自定义](https://jz.wacaijizhang.com/guide/homepage/DIYhome.html) |
| 共享账本 | [多人共享记账](https://jz.wacaijizhang.com/guide/record/share_record.html) |
| 常见问题 | [常见问题汇总](https://jz.wacaijizhang.com/guide/question/Q%26A.html) |
| 关联退款、多次退款和统计 | [怎么记退款](https://jz.wacaijizhang.com/guide/record/record_turnback.html) |
| 周期规则、生成账单及编辑范围 | [周期账](https://jz.wacaijizhang.com/guide/recycle/recycle.html) |

2026-10-21 核对的 [iOS 应用商店开发者更新记录](https://apps.apple.com/cn/app/%E6%8C%96%E8%B4%A2%E8%AE%B0%E8%B4%A6-ai%E8%87%AA%E5%8A%A8%E8%AE%B0%E8%B4%A6/id1544045905) 中，13.1.5 提到周期账修改可影响未来入账。该记录与帮助中的未来生效原则一致，不证明支持追溯批量修改。结合用户当前界面的观察见 [退款与周期记账专题](REFUNDS_AND_RECURRING.md)。

[2020 年版本说明](https://content.wacai.com/web/thread/9901944) 提到多账本收支与个人账户汇总的关系。这是历史设计资料；当前权限和行为需要结合现行帮助与实机确认。

本项目不保存用户提供的原始财务截图、邮件或群聊图片，不复制挖财帮助正文、Logo 或界面素材。文档示例是改写的虚构输入。

用户追加的记账、类别选择、报表、信用卡和借贷界面观察汇总于 [产品设计草案](PRODUCT_DESIGN.md)。其中借贷截图显示四种操作、可选还款日、利息，以及往来方从应收应付账户选择；不据此推断自动计息或逐笔借款核销。

同日用户进一步核对还款前后的付款账户余额：还款主金额包含利息；首页还款与利息两行均打开同一详情，实际资金只扣还款总额，往来余额只抵减本金。这是本次实机还款场景的确认结果，不扩展为未验证的收款等操作结论。用户提出将字段改为“包含利息”，产品草案已记录该文案要求；未将个人账户余额或原始截图入库。

同日只读检查了用户提供的一个邮件导出 XLSX 文件。其结构、实测限制及虚构示例见 [挖财导出结构](WACAI_EXPORT.md)。导出还款行存本金，利息另列；退款用负金额和属性表示。该文件不是挖财完整内部数据模型的证据，源文件和真实账目不随文档入库。

## 短信权限与法规

核对日期为 2026-10-21，结论与适用边界见 [短信访问专题](SMS_ACCESS.md)。

- [个人信息保护法](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm)
- [常见类型 App 必要个人信息范围规定](https://www.cac.gov.cn/2021-03/22/c_1617990997054277.htm)
- [移动互联网应用程序信息服务管理规定](https://www.cac.gov.cn/2022-06/14/c_1656821626455324.htm)
- [网信办个人信息保护政策法规问答（2026 年 1 月）](https://www.cac.gov.cn/2026-01/09/c_1769688003183197.htm)
- [Google Play 短信和通话记录权限政策](https://support.google.com/googleplay/android-developer/answer/10208820?hl=en)
- [Android READ_SMS 权限](https://developer.android.com/reference/android/Manifest.permission#READ_SMS)
- [WebOTP 的验证码用途](https://developer.chrome.com/docs/identity/web-apis/web-otp)
- [Apple TelephonyMessagingKit](https://developer.apple.com/documentation/TelephonyMessagingKit)

## 技术资料

- [Vue 项目创建与工具链](https://vuejs.org/guide/quick-start.html)
- [Vue 与 TypeScript](https://vuejs.org/guide/typescript/overview)
- [Dexie 事务](https://dexie.org/docs/Dexie/Dexie.transaction())
- [Vite PWA](https://vite-pwa-org.netlify.app/guide/)
- [WebKit 存储策略与持久存储](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [Web Crypto 加密 API](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt)
- [Playwright 浏览器支持](https://playwright.dev/docs/browsers)
- [Capacitor](https://capacitorjs.com/docs) 与 [原生构建环境](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Flutter Web 适用场景](https://docs.flutter.dev/platform-integration/web/faq)，作为备选路线的比较依据

## GitHub 存储与授权

- [仓库内容 API](https://docs.github.com/en/rest/repos/contents)
- [Git 引用更新 API](https://docs.github.com/en/rest/git/refs#update-a-reference)
- [REST API 调用限制](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [仓库和文件大小建议](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
- [可接受使用政策](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)
- [细粒度个人访问令牌](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [GitHub App 与 OAuth App 比较](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)
- [GitHub App 用户授权流程](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [REST API 浏览器跨域访问](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests)

资料中的容量、配额和平台行为可能变化，实施时以实际账号与当时官方说明验证。小规模个人同步的技术可行性不代表 GitHub 提供通用数据库能力或无限存储承诺。

## Bes 系列许可参考

本轮本地查阅了 BesFuel、BesMapLab、BesTools，三者均使用 MIT，版权署名为 `Copyright (c) 2026 BensonLaur`。BesLedger 的 [LICENSE](../LICENSE) 从 BesFuel 标准许可证原件复制。Besktop 使用 GPLv3，说明系列产品并非全部采用同一种许可；本项目明确选择 MIT。

MIT 覆盖本项目原创代码与文档，不改变外部参考资料、第三方依赖或真实用户数据的权利归属。实际引入依赖时继续保留其许可信息。

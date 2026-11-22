# 当前版本展示图

四张图由 `scripts/capture-readme.mjs` 从 0.1.4 的生产 Web/PWA 构建实际截图生成，使用独立 Edge 上下文、393×852 视口和 2 倍像素。账本、账户、交易及金额均为虚构样本；工资为 6,000 元，奖金为 400 元，不读取用户账本或原始截图。

原始 PNG 只保存在系统临时目录；展示图整体缩至 590px 宽并使用 256 色 PNG 调色板压缩，没有修改 DOM、重排内容或拼接页面。压缩后逐图检查文字、金额、细线和图表颜色。只保留当前四张必要展示图，不提交原始图和过程截图。

| 展示图 | 原始字节 | 展示图字节 |
| --- | ---: | ---: |
| preview-home.png | 144833 | 71922 |
| preview-entry.png | 115589 | 58803 |
| preview-accounts.png | 121736 | 59640 |
| preview-statistics.png | 113791 | 58976 |
| 合计 | 495949 | 249341 |

图片是缩放减色后的展示文件，不是逐字节保真的原始证据；后续随版本更新可重新运行脚本生成。

## SHA-256

| 文件 | 原始 PNG | 展示 PNG |
| --- | --- | --- |
| preview-home.png | `538a7122035c2f8583e7de317d035139732f96363631e86a3ee0f06519a58c68` | `d1250878c558963230f6c7448009c2c36661fb3d5823b1f6b0b21a98e85014ec` |
| preview-entry.png | `49bc3347ed9eeda0c6c1138e32eac80565bb8931f0bfefdca25a766bb7f3078b` | `e2f9cbf1dd60d6de81c31b1bd4458f809c6c72914fc0f217e9564452ddfc3ac7` |
| preview-accounts.png | `f3eaaa7891ecc918b244f4e674d9502c34bbd0f2cff71c83f1ef15df5b08eeb9` | `085738cf4f22ed55e689bf6d20f49a7a01a7128b5163ba7c4886509c2e3a6748` |
| preview-statistics.png | `b1a1245e1c972824afce68bdca6cba144514a37ad4bc2cd5c7c71821d7912279` | `cdb7fd2f020e52073804447264c7b76e6eee490b6e426eeee1a1a5c04c4fb157` |

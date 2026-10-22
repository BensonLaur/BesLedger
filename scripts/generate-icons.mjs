import sharp from 'sharp';
import fs from 'node:fs';
// 界面与各平台图标共用矢量源；public 副本供 README 和旧安装入口兼容使用。
fs.copyFileSync('src/assets/brand.svg', 'public/icon.svg');
for (const size of [180, 192, 512])
  await sharp('src/assets/brand.svg').resize(size, size).png().toFile(`public/icon-${size}.png`);
fs.copyFileSync('public/icon-180.png', 'src/assets/icon-180.png');

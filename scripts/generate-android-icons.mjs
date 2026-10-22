import fs from 'node:fs';
import sharp from 'sharp';
const root = 'android/app/src/main/res';
const source = fs.readFileSync('public/icon.svg', 'utf8');
const paths = [...source.matchAll(/<path fill="([^"]+)" d="([^"]+)"\/>/g)];
if (paths.length !== 5) throw new Error('Expected the five wallet paths from public/icon.svg');
// 自适应图标由系统裁切背景；缩放前景以保留钱包扣，避免圆形蒙版裁掉边缘。
const foreground = `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="256" android:viewportHeight="256">
    <group android:pivotX="128" android:pivotY="128" android:scaleX="0.75" android:scaleY="0.75">
${paths.map(([, fill, d]) => `        <path android:fillColor="${fill}" android:pathData="${d}" />`).join('\n')}
    </group>
</vector>
`;
fs.writeFileSync(`${root}/drawable/ic_launcher_foreground.xml`, foreground.replace(/\r?\n/g, '\r\n'));
for (const directory of fs.readdirSync(root)) {
  if (!directory.startsWith('mipmap-') && !directory.startsWith('drawable')) continue;
  for (const name of fs.readdirSync(`${root}/${directory}`)) {
    if (!name.endsWith('.png')) continue;
    const path = `${root}/${directory}/${name}`;
    const { width, height } = await sharp(path).metadata();
    const size = name === 'splash.png' ? Math.round(Math.min(width, height) * 0.2) : Math.min(width, height);
    const icon = await sharp('public/icon.svg').resize(size, size).png().toBuffer();
    await sharp({
      create: { width, height, channels: 4, background: '#f6f5ef' },
    })
      .composite([{ input: icon, gravity: 'center' }])
      .png()
      .toFile(path + '.new');
    fs.renameSync(path + '.new', path);
  }
}
fs.copyFileSync(
  `${root}/drawable/ic_launcher_foreground.xml`,
  `${root}/drawable-v24/ic_launcher_foreground.xml`,
);

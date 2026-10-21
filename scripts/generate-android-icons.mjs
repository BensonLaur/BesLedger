import fs from 'node:fs';
import sharp from 'sharp';
const root = 'android/app/src/main/res';
for (const directory of fs.readdirSync(root)) {
  if (!directory.startsWith('mipmap-') && !directory.startsWith('drawable')) continue;
  for (const name of fs.readdirSync(`${root}/${directory}`)) {
    if (!name.endsWith('.png')) continue;
    const path = `${root}/${directory}/${name}`;
    const { width, height } = await sharp(path).metadata();
    const size = name === 'splash.png' ? Math.round(Math.min(width, height) * 0.2) : Math.min(width, height);
    const icon = await sharp('public/icon.svg').resize(size, size).png().toBuffer();
    await sharp({
      create: { width, height, channels: 4, background: name === 'splash.png' ? '#f5f5f2' : '#304765' },
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

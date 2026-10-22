import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

// 包内使用无损 WebP 减小体积；保存时按原尺寸还原 PNG，供支付应用从相册识别。
export async function supportPng(url: string): Promise<Blob> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('暂时无法保存，请打开大图后重试');
  context.drawImage(image, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片转换失败，请重试'))), 'image/png'),
  );
}
export async function saveSupportImage(url: string, name: string): Promise<void> {
  const png = await supportPng(url);
  if (Capacitor.isNativePlatform()) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('图片读取失败，请重试'));
      reader.readAsDataURL(png);
    });
    const file = await Filesystem.writeFile({ path: name, directory: Directory.Cache, data: base64 });
    // 调起系统面板不代表已经保存或付款；由用户选择接收图片的位置。
    await Share.share({ files: [file.uri], title: 'Bes记账收款码', dialogTitle: '保存或分享收款码' });
  } else {
    const href = URL.createObjectURL(png);
    const link = document.createElement('a');
    link.href = href;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 30000);
  }
}

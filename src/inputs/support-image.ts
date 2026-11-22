import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function saveSupportImage(url: string, name: string): Promise<void> {
  // 直接保存包内 PNG，保留减色压缩后的文件字节。
  const response = await fetch(url);
  if (!response.ok) throw new Error('图片读取失败，请重试');
  const png = await response.blob();
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

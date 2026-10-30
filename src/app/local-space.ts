import { Capacitor } from '@capacitor/core';

// 同一份账目可能在浏览器、主屏幕应用或 Android 中使用，称呼依据运行环境而非屏幕尺寸。
export function getLocalSpace() {
  const standalone =
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone;
  if (Capacitor.isNativePlatform())
    return {
      place: '此设备上',
      existing: '此设备已保存账本',
      detail: '账目保存在这台设备的应用中。更换设备时，请使用加密备份或同步取回账本。',
    };
  if (standalone)
    return {
      place: '此应用中',
      existing: '此应用中已保存账本',
      detail: '账目保存在此应用的本地空间中。更换设备或网址时，请使用加密备份或同步取回账本。',
    };
  return {
    place: '此浏览器中',
    existing: '此浏览器中已保存账本',
    detail: '网页账目保存在当前浏览器和网址中。换浏览器或网址后，请使用加密备份或同步取回账本。',
  };
}

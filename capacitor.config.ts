import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.bensoftware.besledger',
  appName: 'Bes记账',
  webDir: 'dist-android',
  // 原生 HTTP 会携带设备码与续期令牌，禁止桥接层记录调用参数（含调试验收包）。
  loggingBehavior: 'none',
  android: { allowMixedContent: false },
};
export default config;

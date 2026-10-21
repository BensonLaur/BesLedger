import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.bensoftware.besledger',
  appName: 'Bes记账',
  webDir: 'dist-android',
  android: { allowMixedContent: false },
};
export default config;

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => ({
  base: mode === 'android' ? '/' : '/BesLedger/',
  resolve: {
    alias:
      mode === 'android'
        ? [
            {
              find: 'virtual:pwa-register/vue',
              replacement: fileURLToPath(new URL('./src/app/native-pwa.ts', import.meta.url)),
            },
          ]
        : [],
  },
  plugins: [
    vue(),
    ...(mode === 'android'
      ? []
      : [
          VitePWA({
            registerType: 'prompt',
            includeAssets: ['icon.svg', 'icon-180.png'],
            manifest: {
              name: 'Bes记账 · BesLedger',
              short_name: 'Bes记账',
              lang: 'zh-CN',
              description: '本地优先的个人记账本',
              theme_color: '#304765',
              background_color: '#f5f5f2',
              display: 'standalone',
              start_url: '.',
              scope: '.',
              icons: [
                { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
                { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
              ],
            },
            workbox: {
              navigateFallback: '/BesLedger/index.html',
              globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
            },
          }),
        ]),
  ],
  build: {
    outDir: mode === 'android' ? 'dist-android' : 'dist',
    target: ['chrome111', 'firefox114', 'safari16.4'],
    sourcemap: false,
  },
}));

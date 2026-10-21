import { ref } from 'vue';
// APK 资源由安装包更新，不能注册 Web Service Worker 劫持原生资源版本。
export function useRegisterSW(_options?: unknown) {
  return { needRefresh: ref(false), updateServiceWorker: async (_reload?: boolean) => undefined };
}

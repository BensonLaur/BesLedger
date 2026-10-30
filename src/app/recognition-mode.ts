const key = 'BesLedger.note-recognition.v1';
let enabledInMemory = false;

// 只保存不含账目信息的本地界面偏好，不触发账本加密写入或跨设备同步。
export function readAutoRecognition(): boolean {
  try {
    enabledInMemory = localStorage.getItem(key) === 'auto';
  } catch {
    /* 存储不可用时，本次打开期间仍可切换。 */
  }
  return enabledInMemory;
}
export function rememberAutoRecognition(enabled: boolean): boolean {
  enabledInMemory = enabled;
  try {
    localStorage.setItem(key, enabled ? 'auto' : 'manual');
    return true;
  } catch {
    return false;
  }
}

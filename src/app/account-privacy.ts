import { ref } from 'vue';

const key = 'besledger.hide-account-amounts';
function read() {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

// 账户页与记账选择器共用同一设备偏好，只保存开关，不保存账户身份或金额。
export const accountAmountsHidden = ref(read());
export function toggleAccountAmounts() {
  accountAmountsHidden.value = !accountAmountsHidden.value;
  try {
    localStorage.setItem(key, String(accountAmountsHidden.value));
  } catch {
    // 存储不可用时，本次打开期间仍保持一致，不影响记账。
  }
}

<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { auth, githubSession, run, ui } from '../store';
import {
  authConfigured,
  installationUrl,
  repositorySetupUrl,
  openAuthorization,
  pollAuthorization,
  startAuthorization,
  type DeviceCode,
} from '../../providers/github/auth';
import Icon from './Icon.vue';
const code = ref<DeviceCode>(),
  waiting = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined,
  started = 0,
  interval = 5,
  generation = 0;
function cancel() {
  generation++;
  clearTimeout(timer);
  waiting.value = false;
  code.value = undefined;
}
onUnmounted(cancel);
async function poll(runId: number) {
  if (!code.value || generation !== runId) return;
  try {
    if (Date.now() > started + code.value.expires_in * 1000) throw new Error('授权码已过期，请重新连接');
    const result = await pollAuthorization({ ...code.value, interval });
    if (generation !== runId) return;
    if (result.tokens) {
      await githubSession.accept(result.tokens, () => generation === runId);
      if (generation !== runId) return;
      cancel();
      if (auth.value) ui.notice = `已连接 ${auth.value.user.login}，此设备将保持登录`;
      return;
    }
    interval = result.interval || interval;
    timer = setTimeout(() => void poll(runId), interval * 1000);
  } catch (e) {
    if (generation === runId) {
      ui.error = (e as Error).message;
      cancel();
    }
  }
}
async function connect() {
  await run(async () => {
    cancel();
    code.value = await startAuthorization();
    started = Date.now();
    interval = Math.max(code.value.interval, 5);
    waiting.value = true;
    timer = setTimeout(() => void poll(generation), interval * 1000);
  });
}
async function logout() {
  cancel();
  const success = await run(async () => {
    await githubSession.logout();
    ui.notice = '已退出 GitHub 并清除本机登录凭证，账目仍可离线使用';
  });
  ui.loginRecovery = !success;
}
</script>
<template>
  <section class="connection-card">
    <div class="section-heading">
      <h2><Icon name="cloud" /> GitHub 连接</h2>
      <span class="tag">{{ auth ? '已登录' : '未连接' }}</span>
    </div>
    <template v-if="auth"
      ><p>
        已登录 <strong>{{ auth.user.login }}</strong
        >。此设备已保持登录，锁定账本不会退出。云端访问须通过专用仓库的安装范围校验。
      </p>
      <div class="actions">
        <RouterLink class="primary" to="/books">管理云端账本</RouterLink
        ><button class="secondary" :disabled="ui.busy" @click="logout">退出 GitHub</button>
      </div>
      <a class="text-button" :href="installationUrl" target="_blank" rel="noopener noreferrer"
        >安装或调整专用仓库访问范围</a
      ></template
    ><template v-else
      ><p>使用 GitHub 作为可选的私有存储。账目先在客户端加密，登录不会上传任何账本。</p>
      <p class="hint">
        使用 GitHub App，仅授予专用私有账本仓库。登录凭证在本机加密保存，刷新、重启和锁定后无需重新授权。
      </p>
      <p v-if="authConfigured" class="hint">
        首次安装选择 Only select repositories，仅勾选自己的 BesLedger-Data 专用私有仓库。GitHub
        安装页要求至少选择一个仓库；安装后可在应用内创建新的私有仓库。
      </p>
      <button v-if="authConfigured" class="secondary" @click="openAuthorization(installationUrl)">
        安装或调整专用仓库访问范围
      </button>
      <p v-if="!authConfigured" class="warning-panel">
        授权服务尚未完成生产配置，真实登录当前未就绪。本地记账不受影响。
      </p>
      <button v-if="!waiting" class="primary" :disabled="ui.busy || !authConfigured" @click="connect">
        <Icon name="cloud" />使用 GitHub 登录
      </button>
      <div v-else class="device-code">
        <small>在 GitHub 输入此一次性授权码</small><strong>{{ code?.user_code }}</strong
        ><button class="primary" @click="openAuthorization(code!.verification_uri)">打开 GitHub 授权</button>
        <p class="hint">完成后自动连接。请核对应用名称为 BesLedger Sync；不应出现 repo 全部仓库授权。</p>
        <button class="text-button" @click="cancel">取消授权</button>
      </div>
      <button v-if="ui.loginRecovery" class="secondary" :disabled="ui.busy" @click="logout">
        退出并清除本机登录
      </button>
    </template>
    <details v-if="authConfigured" class="section">
      <summary>首次使用，还没有专用私有仓库</summary>
      <p class="hint">
        GitHub 要求安装时至少选择一个仓库。首次需要在 GitHub
        确认建库；完成安装后，可在本应用自动创建更多专用私有仓库。
      </p>
      <ol>
        <li>
          在 GitHub 新建 <strong>BesLedger-Data</strong>，可见性务必选择
          <strong>Private</strong>，无需上传文件。
        </li>
        <li>安装本应用，选择 Only select repositories，只勾选这个专用仓库。</li>
        <li>返回这里登录，进入“管理云端账本”选择仓库，再决定上传哪些账本。</li>
      </ol>
      <p class="hint">若同名仓库已存在，先核对它确实是自己的私有账本仓库；不要覆盖或删除已有数据。</p>
      <button class="secondary" @click="openAuthorization(repositorySetupUrl)">
        在 GitHub 创建首个私有仓库
      </button>
    </details>
  </section>
</template>

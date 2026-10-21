<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { auth, run, ui } from '../store';
import {
  authConfigured,
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
    const result = await pollAuthorization(code.value);
    if (generation !== runId) return;
    if (result.github) {
      const user = await result.github.user();
      if (generation !== runId) return;
      auth.value = { github: result.github, user };
      cancel();
      ui.notice = `已通过 GitHub 应用授权连接 ${user.login}`;
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
</script>
<template>
  <section class="connection-card">
    <div class="section-heading">
      <h2><Icon name="cloud" /> GitHub 连接</h2>
      <span class="tag">{{ auth ? '已授权' : '未连接' }}</span>
    </div>
    <template v-if="auth"
      ><p>
        已登录 <strong>{{ auth.user.login }}</strong
        >。授权凭证仅保留在当前应用内存，与账本解密密钥分离。
      </p>
      <div class="actions">
        <RouterLink class="primary" to="/books">管理云端账本</RouterLink
        ><button
          class="secondary"
          @click="
            auth = undefined;
            cancel();
            ui.notice = '已退出当前设备，账目仍可离线使用';
          "
        >
          退出 GitHub
        </button>
      </div>
      <a
        class="text-button"
        href="https://github.com/settings/applications"
        target="_blank"
        rel="noopener noreferrer"
        >在 GitHub 撤销应用授权</a
      ></template
    ><template v-else
      ><p>使用 GitHub 作为可选的私有存储。账目先在客户端加密，登录不会上传任何账本。</p>
      <p class="hint">
        OAuth 需要 repo 权限以创建私有仓库。应用只操作你明确选择的 BesLedger
        数据仓库。关闭或锁定应用后需重新登录。
      </p>
      <p v-if="!authConfigured" class="warning-panel">
        授权服务尚未完成生产配置，真实登录当前未就绪。本地记账不受影响。
      </p>
      <button v-if="!waiting" class="primary" :disabled="ui.busy || !authConfigured" @click="connect">
        <Icon name="cloud" />使用 GitHub 登录
      </button>
      <div v-else class="device-code">
        <small>在 GitHub 输入此一次性授权码</small><strong>{{ code?.user_code }}</strong
        ><button class="primary" @click="openAuthorization(code!.verification_uri)">打开 GitHub 授权</button>
        <p class="hint">完成后自动连接。请核对应用名称为 BesLedger。</p>
        <button class="text-button" @click="cancel">取消授权</button>
      </div></template
    >
  </section>
</template>

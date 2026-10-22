<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { auth, cloudState, online, githubSession, run, ui } from '../store';
import {
  authConfigured,
  installationUrl,
  openAuthorization,
  pollAuthorization,
  startAuthorization,
  type DeviceCode,
} from '../../providers/github/auth';
import Icon from './Icon.vue';
import Modal from './Modal.vue';
const props = defineProps<{ compact?: boolean }>();
const expanded = ref(!props.compact);
const summary = computed(() => {
  if (!auth.value)
    return (
      ui.loginProblem ||
      (ui.loginRecovery ? '无法读取已保存登录，请打开查看' : '未连接 GitHub · 本地记账可正常使用')
    );
  if (!online.value) return '已保存登录 · 暂时离线，可继续本地记账';
  if (cloudState.phase === 'preparing') return `已登录 ${auth.value.user.login} · 正在准备私有存储`;
  if (cloudState.phase === 'error') return '已保存登录 · 暂时无法连接同步存储';
  return `已登录 ${auth.value.user.login} · 此设备保持登录`;
});
const router = useRouter();
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
      await router.push('/books');
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
  if (success) ui.loginProblem = '';
}
</script>
<template>
  <section class="connection-card" :class="{ 'connection-compact': compact }">
    <button v-if="compact" class="connection-summary" :aria-expanded="expanded" @click="expanded = !expanded">
      <Icon name="cloud" /><span
        ><strong>GitHub 连接</strong><small>{{ summary }}</small></span
      ><Icon :name="expanded ? 'chevron-up' : 'right'" :size="18" />
    </button>
    <component
      :is="compact ? Modal : 'div'"
      v-if="expanded"
      class="connection-details"
      title="GitHub 连接"
      @close="expanded = false"
    >
      <div class="section-heading">
        <h2 v-if="!compact"><Icon name="cloud" /> GitHub 连接</h2>
        <span class="tag">{{
          waiting
            ? '等待授权'
            : auth
              ? online
                ? '已登录'
                : '已保存登录 · 离线'
              : ui.loginProblem
                ? '需要检查登录'
                : '未连接'
        }}</span>
      </div>
      <template v-if="auth"
        ><p>
          已登录 <strong>{{ auth.user.login }}</strong
          >。锁定本地空间不会退出 GitHub。
        </p>
        <p v-if="!online" class="hint">暂时离线，登录已在设备上保存。联网后再同步即可。</p>
        <p v-else-if="cloudState.phase === 'preparing'" class="hint">正在准备私有存储，尚未上传任何账本。</p>
        <p v-else-if="cloudState.phase === 'error'" class="warning-panel">
          暂时无法连接同步存储。账目和原绑定已保留，请进入账本管理重试或检查安装范围。
        </p>
        <p class="hint">登录不会上传账本。修改后请点击账本的“同步”，另一设备也需同步获取更新。</p>
        <div class="actions">
          <RouterLink class="primary" to="/books">管理云端账本</RouterLink
          ><button class="secondary" :disabled="ui.busy" @click="logout">退出 GitHub</button>
        </div>
        <a class="text-button" :href="installationUrl" target="_blank" rel="noopener noreferrer"
          >管理 GitHub App 安装</a
        >
        <p class="hint">退出仅清除此设备的 GitHub 登录，不删除账目，也不忘记已保存的同步密钥。</p></template
      ><template v-else
        ><p>使用 GitHub 作为可选的私有存储。账目先在客户端加密，登录不会上传任何账本。</p>
        <p v-if="ui.loginProblem" class="warning-panel">{{ ui.loginProblem }}</p>
        <p class="hint">此设备会加密保存登录，日常解锁后即可继续使用。</p>
        <p v-if="authConfigured" class="hint">
          首次在 GitHub 启用 BesLedger Sync，默认选择 All repositories，再返回登录。无需另装手机软件、注册
          App、建库或部署服务。
        </p>
        <button v-if="authConfigured" class="secondary" @click="openAuthorization(installationUrl)">
          ① 在 GitHub 安装同步应用
        </button>
        <p v-if="authConfigured" class="hint">
          授权范围包含你账号内其他仓库（包括私有仓库）的内容读写权限。应用仅用确认过的账本存储，但这个限制由应用代码执行。
        </p>
        <p v-if="!authConfigured" class="warning-panel">
          授权服务尚未完成生产配置，真实登录当前未就绪。本地记账不受影响。
        </p>
        <button v-if="!waiting" class="primary" :disabled="ui.busy || !authConfigured" @click="connect">
          <Icon name="cloud" />使用 GitHub 登录
        </button>
        <div v-else class="device-code">
          <small>等待你在 GitHub 完成授权 · 输入以下一次性码</small><strong>{{ code?.user_code }}</strong
          ><button class="primary" @click="openAuthorization(code!.verification_uri)">
            打开 GitHub 授权
          </button>
          <p class="hint">核对应用名称为 BesLedger Sync。完成后自动连接并准备私有存储。</p>
          <button class="text-button" @click="cancel">取消授权</button>
        </div>
        <button v-if="ui.loginRecovery" class="secondary" :disabled="ui.busy" @click="logout">
          退出并清除本机登录
        </button>
      </template>
      <details v-if="authConfigured" class="section">
        <summary>了解 GitHub 授权范围</summary>
        <p class="hint">
          All repositories
          授予应用读写账号中所有仓库内容及创建仓库的能力，包含未来仓库。当前代码只操作确认过的账本存储，但令牌泄露仍可能影响其他仓库；开源不等于平台隔离。
        </p>
        <p class="hint">
          仅请求 Contents 写入、Repository creation 写入、Metadata 只读，不申请仓库管理权限。你也可自行选择
          Only select repositories 限定范围，但首次需要已有专用仓库。本地记账无需 GitHub。
        </p>
      </details>
    </component>
  </section>
</template>

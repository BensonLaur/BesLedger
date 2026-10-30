<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  auth,
  cloudState,
  online,
  currentLedgerId,
  ledgers,
  mutate,
  refresh,
  rememberSyncKey,
  run,
  state,
  ui,
  vault,
} from '../store';
import { list, put, tombstone, type Binding, type Entity, type SyncReview } from '../../domain/model';
import { canonical, digest } from '../../crypto/vault';
import { previewDownloadLedger, syncLedger } from '../../sync/engine';
import { ledgerProjection, mainStatus, mergeEntities } from '../../sync/merge';
import { applySyncReview } from '../../sync/review';
import { type SyncKeyLease } from '../../storage/vault';
import { type Repository } from '../../providers/github/client';
import { getLocalSpace } from '../local-space';
import GitHubConnection from '../components/GitHubConnection.vue';
import Modal from '../components/Modal.vue';
import Icon from '../components/Icon.vue';
import SecretField from '../components/SecretField.vue';
import RecoveryKey from '../components/RecoveryKey.vue';
import ConflictComparison from '../components/ConflictComparison.vue';
const router = useRouter(),
  localSpace = getLocalSpace();
const operationErrors = ref<Record<string, string>>({}),
  operating = ref('');
const bookName = ref(''),
  creating = ref(false),
  renameId = ref(''),
  renameName = ref('');
const repositories = ref<Repository[]>([]),
  selectedRepo = ref(''),
  repoName = ref('BesLedger-Data');
const savedKeys = ref<Record<string, boolean>>({}),
  status = ref<Record<string, string>>({});
const moreId = ref(''),
  forgettingKey = ref(''),
  removing = ref(''),
  deleteCloud = ref(''),
  reviewId = ref('');
const uploadId = ref(''),
  uploadSaved = ref(false),
  uploadShowKey = ref(false);
const transferId = ref(''),
  recovery = ref(''),
  replaceKey = ref(false),
  transferAction = ref<'download' | 'sync'>('download');
const secretReset = ref(0);
type Preview = {
  entities: Record<string, Entity>;
  remoteHash: string;
  lease: SyncKeyLease;
  binding: Binding;
  login: NonNullable<typeof auth.value>;
  base: string;
};
const preview = shallowRef<Preview>();
let preparedFor = 0,
  alive = true,
  transferEpoch = 0;
onUnmounted(() => {
  alive = false;
  transferEpoch++;
  recovery.value = '';
  preview.value = undefined;
});
const canNetwork = computed(() => !!auth.value && online.value && !ui.busy);
const cloudOnly = computed(() =>
  Object.entries(state.value!.bindings).filter(
    ([id, b]) =>
      b.remoteExists && !state.value!.entities[id] && (!auth.value || b.userId === auth.value.user.id),
  ),
);
const selectedRepository = computed(() => repositories.value.find((r) => r.full_name === selectedRepo.value));
const review = computed(() => state.value?.syncReviews?.[reviewId.value]);
const reviewComplete = computed(() => review.value?.conflicts.every((c) => !!review.value!.choices[c.id]));
function bookTitle(id: string) {
  const d = state.value?.entities[id]?.data;
  return d?.kind === 'ledger' ? d.name : `尚未解锁的云端账本 · ${id.slice(-8)}`;
}
function checkedTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
function pendingCount(id: string) {
  return state.value?.syncReviews?.[id]?.conflicts.length || 0;
}
function statusLabel(id: string) {
  if (operating.value === id) return '正在同步…';
  if (pendingCount(id)) return `${pendingCount(id)} 项差异待核对`;
  if (operationErrors.value[id]) return '同步未完成';
  if (status.value[id] === '仅本地') return '只在这里保存';
  if (status.value[id] === '待同步') return '有更新待同步';
  return status.value[id] === '已同步' ? '上次同步成功' : '检查中';
}
function friendlyError(error: unknown): Error {
  if (!online.value || error instanceof TypeError)
    return new Error('暂时无法连接，请联网后重试。原有账目未改动。');
  const message = error instanceof Error ? error.message : '操作没有完成，请重试';
  if (message.includes('密钥不匹配') || message.includes('64 位'))
    return new Error('恢复密钥不正确或不完整，请核对原设备保存的密钥。已有账目和已保存密钥未改动。');
  return new Error(message);
}
function assertSession(login: NonNullable<typeof auth.value>, requirePage = true) {
  if ((requirePage && !alive) || auth.value !== login || !state.value)
    throw new Error('页面或登录状态已改变，请重新操作');
}
function knownRepositories() {
  return Object.values(state.value!.bindings)
    .filter(
      (b) =>
        b.userId === auth.value?.user.id && b.owner.toLowerCase() === auth.value.user.login.toLowerCase(),
    )
    .map((b) => b.repo);
}
watch(
  [auth, () => ui.busy],
  ([login, busy]) => {
    if (!login) {
      preparedFor = 0;
      return;
    }
    if (!busy && preparedFor !== login.user.id) {
      preparedFor = login.user.id;
      void prepareCloud();
    }
  },
  { immediate: true },
);
watch(
  state,
  async (s) => {
    if (!s) return;
    const next: Record<string, string> = {},
      saved: Record<string, boolean> = {};
    for (const [id, binding] of Object.entries(s.bindings)) saved[id] = await vault.hasSyncKey(id, binding);
    for (const book of list(s, 'ledger')) {
      const b = s.bindings[book.id];
      next[book.id] = mainStatus(
        true,
        !!b?.remoteExists,
        !b?.syncedDigest || b.syncedDigest !== (await digest(ledgerProjection(s, book.id))),
      );
    }
    if (state.value === s) {
      status.value = next;
      savedKeys.value = saved;
    }
  },
  { immediate: true },
);
async function createBook() {
  await run(async () => {
    await mutate((s) => {
      const e = put(s, { kind: 'ledger', name: bookName.value });
      s.preferences.currentLedger = e.id;
    });
    creating.value = false;
    bookName.value = '';
  });
}
async function renameBook() {
  await run(async () => {
    await mutate((s) => put(s, { kind: 'ledger', name: renameName.value }, renameId.value));
    renameId.value = '';
  });
}
async function selectBook(id: string) {
  const okay = await run(async () => {
    await mutate((s) => {
      s.preferences.currentLedger = id;
    });
    ui.selectedDay = '';
  });
  if (okay) await router.push('/');
}
async function getRepos() {
  await run(async () => {
    repositories.value = await auth.value!.github.repositories(knownRepositories());
  });
}
async function prepareCloud() {
  const login = auth.value;
  if (!login || ui.busy) return;
  cloudState.phase = 'preparing';
  cloudState.error = '';
  const okay = await run(async () => {
    try {
      const repo = await login.github.prepareRepository(knownRepositories());
      assertSession(login, false);
      repositories.value = [repo];
      selectedRepo.value = repo.full_name;
      await discoverContents();
      ui.notice = '连接成功，选择要同步的账本。登录没有上传任何账目。';
    } catch (error) {
      throw friendlyError(error);
    }
  });
  if (auth.value !== login) return;
  cloudState.phase = okay ? 'ready' : 'error';
  cloudState.error = okay ? '' : ui.error;
}
async function createRepo() {
  await run(async () => {
    const repo = await auth.value!.github.createRepository(repoName.value);
    repositories.value = [...repositories.value.filter((r) => r.full_name !== repo.full_name), repo];
    selectedRepo.value = repo.full_name;
    ui.notice = '独立同步存储已创建';
  });
}
async function discover() {
  await run(discoverContents);
}
async function discoverContents() {
  const repo = selectedRepository.value,
    login = auth.value;
  if (!repo || !login) throw new Error('同步存储尚未准备好，请重试连接');
  const files = await login.github.discover(repo.owner.login, repo.name, login.user.id);
  assertSession(login, false);
  await mutate((s) => {
    for (const f of files) {
      const previous = s.bindings[f.id];
      if (
        previous &&
        (previous.owner !== repo.owner.login ||
          previous.repo !== repo.name ||
          previous.userId !== login.user.id)
      )
        throw new Error('这本账已连接其他同步位置，请先核对');
      s.bindings[f.id] = {
        ...previous,
        owner: repo.owner.login,
        repo: repo.name,
        userId: login.user.id,
        remoteExists: true,
        remoteHash: f.sha,
        lastChecked: new Date().toISOString(),
        ...(previous && previous.remoteHash !== f.sha ? { syncedDigest: undefined } : {}),
      };
    }
  });
}
async function saveReview(
  id: string,
  remote: Record<string, Entity>,
  remoteHash: string | undefined,
  snapshot: typeof state.value,
  lease: SyncKeyLease,
) {
  const merged = mergeEntities(snapshot!.entities, remote),
    baseDigest = await digest(snapshot!.entities);
  await rememberSyncKey(lease, (s) => {
    if (canonical(s.entities) !== canonical(snapshot!.entities))
      throw new Error('检查期间这里的账目有变化，请重新同步后核对');
    s.syncReviews ??= {};
    s.syncReviews[id] = { remote, remoteHash, conflicts: merged.conflicts, choices: {}, baseDigest };
  });
  reviewId.value = id;
  ui.notice = '发现两边不同的内容，请核对后选择。双方记录已保留在这里，尚未上传。';
}
function requestSync(id: string) {
  ui.error = '';
  if (pendingCount(id)) {
    reviewId.value = id;
    return;
  }
  if (!state.value!.bindings[id]?.remoteExists) {
    uploadId.value = id;
    uploadSaved.value = uploadShowKey.value = false;
    return;
  }
  if (!savedKeys.value[id]) {
    startTransfer(id, 'sync');
    return;
  }
  void performSync(id);
}
async function performSync(id: string, key = '') {
  if (ui.busy) return;
  operationErrors.value[id] = '';
  operating.value = id;
  const okay = await run(async () => {
    try {
      const login = auth.value;
      if (!login) throw new Error('请先登录 GitHub');
      const previous = state.value!.bindings[id],
        repo = selectedRepository.value;
      const binding: Binding =
        previous ||
        (repo
          ? { owner: repo.owner.login, repo: repo.name, userId: login.user.id, remoteExists: false }
          : (() => {
              throw new Error('同步尚未准备好，请先检查连接');
            })());
      if (binding.userId !== login.user.id) throw new Error('请切回这本账原来连接的 GitHub 账号后同步');
      const snapshot = structuredClone(state.value!);
      const lease = await vault.prepareSyncKey(id, binding, key, !binding.remoteExists);
      const result = await syncLedger(snapshot, id, binding, lease.key, login.github);
      lease.assertCurrent();
      assertSession(login);
      if (result.conflicts.length) {
        await saveReview(id, result.remoteEntities!, result.binding.remoteHash, snapshot, lease);
        uploadId.value = '';
        closeTransfer(true);
        return;
      }
      await rememberSyncKey(lease, (s) => {
        const merge = mergeEntities(s.entities, result.entities);
        if (merge.conflicts.length) throw new Error('同步期间这里又有修改，请重新同步后核对');
        s.entities = merge.entities;
        s.bindings[id] = result.binding;
        if (s.syncReviews) delete s.syncReviews[id];
        if (s.entities[s.preferences.currentLedger]?.deleted)
          s.preferences.currentLedger = list(s, 'ledger')[0]?.id || '';
      });
      uploadId.value = '';
      closeTransfer(true);
      ui.notice = previous?.remoteExists
        ? '本轮同步成功。另一台设备也需点击“同步”才能看到更新。'
        : '首次上传成功。在另一台设备选择“从其他设备取回账本”，登录同一个 GitHub 账号即可继续。';
    } catch (error) {
      throw friendlyError(error);
    }
  });
  operating.value = '';
  if (!okay) operationErrors.value[id] = ui.error;
}
function invalidatePreview() {
  preview.value = undefined;
  secretReset.value++;
  ui.error = '';
}
function startTransfer(id: string, action: 'download' | 'sync' = 'download') {
  if (ui.busy) return;
  transferEpoch++;
  transferId.value = id;
  transferAction.value = action;
  recovery.value = '';
  replaceKey.value = !savedKeys.value[id];
  invalidatePreview();
}
function closeTransfer(force = false) {
  if (ui.busy && !force) return;
  transferEpoch++;
  transferId.value = recovery.value = '';
  preview.value = undefined;
  replaceKey.value = false;
  ui.error = '';
}
async function inspectDownload() {
  const id = transferId.value,
    epoch = transferEpoch;
  secretReset.value++;
  const okay = await run(async () => {
    try {
      const login = auth.value;
      if (!login) throw new Error('请先登录 GitHub');
      const binding = structuredClone(state.value!.bindings[id]);
      const base = canonical(state.value!.entities),
        lease = await vault.prepareSyncKey(id, binding, recovery.value);
      const remote = await previewDownloadLedger(id, binding, lease.key, login.github);
      lease.assertCurrent();
      assertSession(login);
      if (epoch !== transferEpoch) return;
      if (remote.entities[id].deleted)
        throw new Error('这本云端账本已删除，不能作为正常账本添加。这里已有的账目未改动。');
      preview.value = { ...remote, lease, binding, login, base };
    } catch (error) {
      throw friendlyError(error);
    }
  });
  if (!okay) {
    await nextTick();
    const input = document.getElementById('book-recovery') as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }
}
async function confirmDownload() {
  const id = transferId.value,
    shown = preview.value,
    epoch = transferEpoch;
  if (!shown || ui.busy) return;
  const okay = await run(async () => {
    try {
      shown.lease.assertCurrent();
      assertSession(shown.login);
      if (canonical(state.value!.entities) !== shown.base)
        throw new Error('这里的账目已有变化，请重新预览后添加');
      // 确认时再次读取并验证同一云端版本，预览或取消都不采用密钥、不写入账目。
      const latest = await previewDownloadLedger(id, shown.binding, shown.lease.key, shown.login.github);
      shown.lease.assertCurrent();
      assertSession(shown.login);
      if (epoch !== transferEpoch) return;
      if (latest.remoteHash !== shown.remoteHash) throw new Error('云端账本已更新，请重新预览后添加');
      const snapshot = structuredClone(state.value!),
        merge = mergeEntities(snapshot.entities, latest.entities);
      if (merge.conflicts.length) {
        await saveReview(id, latest.entities, latest.remoteHash, snapshot, shown.lease);
        closeTransfer(true);
        return;
      }
      const syncedDigest = await digest(latest.entities),
        proposed = { ...snapshot, entities: merge.entities };
      const fullySynced = (await digest(ledgerProjection(proposed, id))) === syncedDigest;
      await rememberSyncKey(shown.lease, (s) => {
        if (canonical(s.entities) !== shown.base) throw new Error('这里的账目已有变化，请重新预览后添加');
        s.entities = merge.entities;
        s.bindings[id] = {
          ...shown.binding,
          remoteHash: latest.remoteHash,
          syncedDigest,
          lastChecked: new Date().toISOString(),
          ...(fullySynced ? { lastSynced: new Date().toISOString() } : {}),
        };
        s.preferences.currentLedger = id;
      });
      closeTransfer(true);
      ui.notice = '账本已添加，原有账本继续保留，可以离线记账。修改后请在两台设备分别点击“同步”。';
    } catch (error) {
      throw friendlyError(error);
    }
  });
  if (!okay) preview.value = undefined;
}
function previewName() {
  const d = preview.value?.entities[transferId.value]?.data;
  return d?.kind === 'ledger' ? d.name : '';
}
function previewCounts() {
  const entities = Object.values(preview.value?.entities || {}).filter((e) => !e.deleted);
  return `${entities.filter((e) => e.data.kind === 'entry').length} 笔账目、${entities.filter((e) => e.data.kind === 'account').length} 个关联账户`;
}
async function forgetKey() {
  await run(async () => {
    const id = forgettingKey.value,
      b = state.value!.bindings[id];
    if (!b) throw new Error('这本账尚未开启同步');
    await vault.forgetSyncKey(id, b);
    refresh();
    forgettingKey.value = '';
    ui.notice = '已忘记这里保存的同步密钥，账目和云端内容未删除。';
  });
}
async function chooseConflict(id: string, choice: 'local' | 'remote') {
  await run(async () => {
    await mutate((s) => {
      const batch = s.syncReviews?.[reviewId.value];
      if (!batch) throw new Error('请重新检查差异');
      batch.choices[id] = choice;
    });
  });
}
async function applyReview() {
  await run(async () => {
    const id = reviewId.value,
      before = canonical(state.value!.entities),
      hash = await digest(state.value!.entities);
    await mutate((s) => {
      if (canonical(s.entities) !== before) throw new Error('这里的账目已有变化，请重新同步后核对');
      applySyncReview(s, id, hash);
    });
    reviewId.value = '';
    ui.notice = '核对结果已保存在这里，请点击这本账的“同步”提交结果。';
  });
}
function recheckReview() {
  const id = reviewId.value;
  reviewId.value = '';
  if (state.value!.entities[id]) void performSync(id);
  else startTransfer(id);
}
async function removeLocal() {
  await run(async () => {
    try {
      const id = removing.value,
        b = state.value!.bindings[id],
        login = auth.value;
      if (!login || !online.value) throw new Error('移除前需要联网确认云端副本，请先连接 GitHub');
      if (status.value[id] !== '已同步' || pendingCount(id))
        throw new Error('请先完成同步并核对差异，避免丢失这里尚未上传的修改');
      const snapshot = canonical(state.value!.entities),
        lease = await vault.prepareSyncKey(id, b, '', true);
      const remote = await previewDownloadLedger(id, b, lease.key, login.github);
      lease.assertCurrent();
      assertSession(login);
      if ((await digest(remote.entities)) !== (await digest(ledgerProjection(state.value!, id))))
        throw new Error('云端内容有变化，请先同步，再移除这里的副本');
      await mutate((s) => {
        if (canonical(s.entities) !== snapshot) throw new Error('这里的账目有变化，请先同步');
        for (const e of Object.values(s.entities))
          if (e.id === id || ('ledgerId' in e.data && e.data.ledgerId === id)) delete s.entities[e.id];
        s.preferences.currentLedger = list(s, 'ledger')[0]?.id || '';
      });
      removing.value = '';
      ui.notice = '已移除这里的账本副本，云端保留，可重新下载。这里的账户余额范围随之变化。';
    } catch (error) {
      throw friendlyError(error);
    }
  });
}
async function deleteLedger() {
  await run(async () => {
    const id = deleteCloud.value;
    if (pendingCount(id)) throw new Error('请先核对这本账的差异，再决定是否删除');
    await mutate((s) => {
      for (const e of Object.values(s.entities))
        if (e.id === id || ('ledgerId' in e.data && e.data.ledgerId === id)) tombstone(s, e.id);
      s.preferences.currentLedger = list(s, 'ledger')[0]?.id || '';
    });
    deleteCloud.value = '';
    ui.notice =
      '这本账已在这里删除。已开启同步的账本还需同步删除，其他设备才会收到。可到“我的 → 回收站”找回。';
  });
}
const deletedBooks = computed(() =>
  Object.values(state.value!.entities).filter((e) => e.deleted && e.data.kind === 'ledger'),
);
</script>
<template>
  <div class="page-heading">
    <div>
      <p class="eyebrow">一本账，一段生活</p>
      <h1>账本管理</h1>
    </div>
    <button class="secondary" :disabled="ui.busy" @click="creating = true">
      <Icon name="plus" />新建账本
    </button>
  </div>
  <div class="book-intro">
    <h2>{{ ledgers.length ? '选择要使用或同步的账本' : '从其他设备取回账本' }}</h2>
    <p>登录不会上传或替换账本。修改后，在两台设备分别点击“同步”获取更新。</p>
  </div>
  <GitHubConnection v-if="!auth" key="login" /><GitHubConnection v-else key="connected" compact />
  <p v-if="auth && cloudState.phase === 'preparing'" role="status" class="scope-note">
    正在检查云端账本，尚未上传任何账目…
  </p>
  <p v-else-if="auth && cloudState.phase === 'ready'" class="scope-note">连接已就绪，选择要同步的账本。</p>
  <p v-if="!online" class="warning-panel">当前离线，已有账本仍可记账。云端是否有新内容，需要联网后检查。</p>
  <section v-if="ledgers.length" class="section">
    <h2>这里的账本</h2>
    <div class="book-grid">
      <article
        v-for="book in ledgers"
        :data-book-id="book.id"
        :key="book.id"
        class="book-card"
        :class="{ selected: currentLedgerId === book.id }"
      >
        <div class="section-heading">
          <span class="entry-icon"><Icon name="book" /></span
          ><span class="tag">{{ statusLabel(book.id) }}</span>
        </div>
        <h3>{{ book.data.name }}</h3>
        <small v-if="currentLedgerId === book.id" class="muted">当前正在使用</small>
        <small v-if="state!.bindings[book.id]?.lastSynced" class="muted"
          >上次成功同步：{{ checkedTime(state!.bindings[book.id].lastSynced!) }}</small
        >
        <small v-if="state!.bindings[book.id]?.lastChecked" class="muted"
          >最近检查云端：{{ checkedTime(state!.bindings[book.id].lastChecked!) }}</small
        >
        <small
          v-if="state!.bindings[book.id]?.remoteExists && auth?.user.id !== state!.bindings[book.id].userId"
          class="muted"
          >登录这本账原来连接的 GitHub 账号后可同步</small
        >
        <small v-if="operationErrors[book.id]" class="field-error">{{ operationErrors[book.id] }}</small>
        <div class="book-actions">
          <button class="primary" :disabled="ui.busy" @click="selectBook(book.id)">进入账本</button
          ><button
            v-if="auth || pendingCount(book.id)"
            class="secondary"
            :disabled="
              ui.busy ||
              (!pendingCount(book.id) &&
                (!canNetwork ||
                  (state!.bindings[book.id] && auth?.user.id !== state!.bindings[book.id].userId)))
            "
            @click="requestSync(book.id)"
          >
            {{
              pendingCount(book.id)
                ? '核对差异'
                : state!.bindings[book.id]?.remoteExists
                  ? '同步'
                  : '首次上传'
            }}</button
          ><button
            class="icon-button"
            :aria-label="`${book.data.name}的更多操作`"
            :disabled="ui.busy"
            @click="moreId = book.id"
          >
            <Icon name="more" />
          </button>
        </div>
      </article>
    </div>
  </section>
  <section v-if="cloudOnly.length" class="section">
    <h2>其他设备已上传的账本</h2>
    <p class="hint">尚未下载到这里。验证原设备恢复密钥后，可先预览再添加。</p>
    <div class="book-grid">
      <article v-for="[id] in cloudOnly" :key="id" class="book-card cloud-book">
        <span class="tag">{{ pendingCount(id) ? `${pendingCount(id)} 项差异待核对` : '尚未下载' }}</span>
        <h3>{{ bookTitle(id) }}</h3>
        <p class="hint">名称和内容经过加密，验证密钥后显示。</p>
        <p v-if="operationErrors[id]" class="field-error">{{ operationErrors[id] }}</p>
        <button
          class="primary"
          :disabled="ui.busy || (!pendingCount(id) && !canNetwork)"
          @click="pendingCount(id) ? (reviewId = id) : startTransfer(id)"
        >
          {{ pendingCount(id) ? '核对差异' : '预览并下载' }}
        </button>
      </article>
    </div>
  </section>
  <p v-if="auth && cloudState.phase === 'ready' && !cloudOnly.length" class="scope-note">
    没有其他尚未下载的云端账本。要取回另一本账，请先在原设备点击“首次上传”，再回来检查。
  </p>
  <section v-if="deletedBooks.length" class="card section">
    <h2>已删除的账本</h2>
    <div v-for="book in deletedBooks" :key="book.id" class="section-heading">
      <span>{{ bookTitle(book.id) }}</span
      ><button
        v-if="auth && state!.bindings[book.id]"
        class="text-button"
        :disabled="!canNetwork"
        @click="pendingCount(book.id) ? (reviewId = book.id) : performSync(book.id)"
      >
        {{ pendingCount(book.id) ? '核对差异' : '同步删除' }}
      </button>
    </div>
    <p class="hint">同步删除后，其他设备也会收到。需要找回时，请到“我的 → 回收站”恢复，再同步。</p>
  </section>
  <section v-if="auth" class="card section">
    <h2>检查同步连接</h2>
    <p v-if="cloudState.phase === 'error'" class="warning-panel">
      暂时无法检查云端账本，已有账目和连接信息保留。{{ cloudState.error }}
    </p>
    <button class="secondary" :disabled="!canNetwork" @click="prepareCloud">检查云端账本</button>
    <details class="section">
      <summary>同步设置与故障排查</summary>
      <p class="hint">存储由应用自动准备，普通使用无需填写仓库名称。</p>
      <p v-if="selectedRepo" class="hint">已准备：{{ selectedRepo }}</p>
      <button class="secondary" :disabled="!canNetwork" @click="getRepos">查找已有账本仓库</button
      ><label
        >数据仓库<select v-model="selectedRepo">
          <option value="">请选择</option>
          <option v-for="r in repositories" :key="r.full_name" :value="r.full_name">{{ r.full_name }}</option>
        </select></label
      ><button class="secondary" :disabled="!canNetwork || !selectedRepo" @click="discover">
        检查所选存储
      </button>
      <form class="inline-form" @submit.prevent="createRepo">
        <input v-model="repoName" aria-label="新私有仓库名称" /><button
          class="secondary"
          :disabled="!canNetwork"
        >
          创建独立私有存储
        </button>
      </form>
    </details>
  </section>
  <Modal v-if="moreId" :title="bookTitle(moreId) + ' · 更多操作'" @close="moreId = ''"
    ><div class="settings-actions">
      <button
        @click="
          renameId = moreId;
          renameName = bookTitle(moreId);
          moreId = '';
        "
      >
        账本改名<Icon name="right" /></button
      ><button
        v-if="state!.bindings[moreId]"
        @click="
          forgettingKey = moreId;
          moreId = '';
        "
      >
        同步密钥<Icon name="right" /></button
      ><button
        v-if="state!.bindings[moreId]?.remoteExists"
        @click="
          removing = moreId;
          moreId = '';
        "
      >
        仅移除这里的副本<Icon name="right" /></button
      ><button
        class="danger-text"
        @click="
          deleteCloud = moreId;
          moreId = '';
        "
      >
        删除账本<Icon name="right" />
      </button></div
  ></Modal>
  <Modal v-if="uploadId" :title="bookTitle(uploadId) + ' · 首次上传'" @close="!ui.busy && (uploadId = '')"
    ><p>仅将“{{ bookTitle(uploadId) }}”的加密副本上传到你的 GitHub，其他本地账本不会一起上传。</p>
    <p>另一台设备取回这本账时，需要这里的恢复密钥，请先保存好。</p>
    <button class="text-button" :disabled="ui.busy" @click="uploadShowKey = !uploadShowKey">
      查看与保存恢复密钥</button
    ><RecoveryKey v-if="uploadShowKey" :value="vault.recovery" /><label class="checkbox"
      ><input
        v-model="uploadSaved"
        type="checkbox"
        :disabled="ui.busy"
      />我已保存取回这本账需要的恢复密钥</label
    ><button class="primary full" :disabled="!canNetwork || !uploadSaved" @click="performSync(uploadId)">
      确认首次上传
    </button>
    <p v-if="ui.error" class="field-error">{{ ui.error }}</p></Modal
  >
  <Modal
    v-if="transferId"
    :title="transferAction === 'download' ? '取回这本账' : '输入这本账的恢复密钥'"
    @close="closeTransfer()"
    ><p>{{ bookTitle(transferId) }}</p>
    <template v-if="!preview"
      ><p v-if="!replaceKey" class="hint">取回密钥已在{{ localSpace.place }}加密保存，无需再次输入。</p>
      <SecretField
        v-if="replaceKey"
        id="book-recovery"
        v-model="recovery"
        label="原设备的恢复密钥"
        :disabled="ui.busy"
        :reset="secretReset"
        @update:model-value="invalidatePreview"
      />
      <details v-if="replaceKey" class="help-details">
        <summary>去原设备哪里找？</summary>
        <p>
          在最初上传这本账的设备打开“我的 → 查看与保存恢复密钥”。这里新生成的密钥不能代替它；解锁密码和 GitHub
          密码也不能代替。
        </p>
        <p>如果这本账也是从其他设备下载的，请使用最初上传设备保存的密钥。</p>
      </details>
      <button
        v-if="!replaceKey"
        class="text-button"
        :disabled="ui.busy"
        @click="
          replaceKey = true;
          invalidatePreview();
        "
      >
        更换恢复密钥</button
      ><button
        class="primary full"
        :disabled="!canNetwork || (replaceKey && !recovery)"
        @click="transferAction === 'download' ? inspectDownload() : performSync(transferId, recovery)"
      >
        {{ transferAction === 'download' ? '验证并预览' : '验证并同步' }}
      </button></template
    ><template v-else
      ><div class="success-panel" role="status">
        <strong>{{ previewName() }}</strong>
        <p>{{ previewCounts() }}</p>
      </div>
      <p>确认后添加到这里，与已有账本并存。同名账本也不会自动合并。</p>
      <button class="primary full" :disabled="!canNetwork" @click="confirmDownload">确认添加账本</button
      ><button class="text-button" :disabled="ui.busy" @click="invalidatePreview">重新验证</button></template
    ><button class="text-button" :disabled="ui.busy" @click="closeTransfer()">取消</button>
    <p v-if="ui.error" class="field-error" role="alert">{{ ui.error }}</p></Modal
  >
  <Modal v-if="forgettingKey" :title="bookTitle(forgettingKey) + ' · 同步密钥'" @close="forgettingKey = ''"
    ><p>
      {{
        savedKeys[forgettingKey]
          ? '这本账的同步密钥已在这里加密保存，日常同步无需输入。'
          : '这里尚未保存这本账的同步密钥。'
      }}
    </p>
    <p>忘记密钥不删除这里或云端的账目，之后可能需要原设备保存的恢复密钥。</p>
    <button
      class="secondary full"
      :disabled="ui.busy"
      @click="
        startTransfer(forgettingKey, 'sync');
        replaceKey = true;
        forgettingKey = '';
      "
    >
      更换恢复密钥并同步</button
    ><button v-if="savedKeys[forgettingKey]" class="danger" :disabled="ui.busy" @click="forgetKey">
      忘记这里保存的密钥
    </button></Modal
  >
  <Modal
    v-if="creating || renameId"
    :title="renameId ? '账本改名' : '新建本地账本'"
    @close="
      creating = false;
      renameId = '';
    "
    ><form @submit.prevent="renameId ? renameBook() : createBook()">
      <label
        >账本名称<input v-if="renameId" v-model="renameName" required maxlength="100" /><input
          v-else
          v-model="bookName"
          required
          maxlength="100"
          placeholder="例如：日常生活"
      /></label>
      <p class="hint">这里新建的账本只在本地保存，首次上传由你决定。同名账本不会自动合并。</p>
      <button class="primary full" :disabled="ui.busy">保存</button>
    </form></Modal
  >
  <Modal v-if="review" :title="bookTitle(reviewId) + ' · 核对差异'" wide @close="reviewId = ''"
    ><p>有 {{ review.conflicts.length }} 项内容需要核对，底色突出不同之处。所有项目选好后，再确认保存。</p>
    <ConflictComparison
      v-for="c in review.conflicts"
      :key="c.id"
      :conflict="c"
      :state="state!"
      :remote="review.remote"
      :choice="review.choices[c.id]"
      :disabled="ui.busy"
      @choose="chooseConflict(c.id, $event)"
    /><button class="primary full" :disabled="ui.busy || !reviewComplete" @click="applyReview">
      确认选择并保存</button
    ><button class="text-button" :disabled="ui.busy" @click="reviewId = ''">稍后处理</button
    ><button class="text-button" :disabled="!canNetwork" @click="recheckReview">重新检查差异</button>
    <p class="hint">保存选择后还需点击这本账的“同步”。稍后处理会保留双方内容及你的选择。</p>
    <p v-if="ui.error" class="field-error">{{ ui.error }}</p></Modal
  >
  <Modal v-if="removing" title="仅移除这里的副本" @close="!ui.busy && (removing = '')"
    ><h3>{{ bookTitle(removing) }}</h3>
    <p>移除前会联网确认云端副本与这里一致。云端账本保留，可重新下载。</p>
    <p>这里的余额和统计将不再包含这本账的流水，共用账户继续保留。</p>
    <button class="danger" :disabled="!canNetwork" @click="removeLocal">确认移除这里的副本</button>
    <p v-if="ui.error" class="field-error">{{ ui.error }}</p></Modal
  >
  <Modal v-if="deleteCloud" title="删除账本" @close="!ui.busy && (deleteCloud = '')"
    ><h3>{{ bookTitle(deleteCloud) }}</h3>
    <p>删除这本账及其中的账目，这里的余额和统计会随之变化，共用账户保留。</p>
    <p v-if="state!.bindings[deleteCloud]?.remoteExists">随后还需点击“同步删除”，其他设备才会收到删除。</p>
    <p>可以在“我的 → 回收站”找回。建议先导出备份。</p>
    <button class="danger" :disabled="ui.busy || !!pendingCount(deleteCloud)" @click="deleteLedger">
      确认删除这本账
    </button>
    <p v-if="pendingCount(deleteCloud)" class="hint">请先核对差异再决定是否删除。</p>
    <p v-if="ui.error" class="field-error">{{ ui.error }}</p></Modal
  >
</template>
<style scoped>
.book-intro {
  margin-bottom: 20px;
}
.book-intro h2 {
  font-size: 18px;
}
.book-intro p,
.scope-note {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
}
.book-card > small {
  display: block;
  margin-top: 6px;
  line-height: 1.6;
  font-size: 12px;
}
.book-actions button {
  font-size: 14px;
}
.book-card h3 {
  font-size: 18px;
  margin: 12px 0;
  overflow-wrap: anywhere;
}
.book-grid {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
}
.book-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.book-actions .primary,
.book-actions .secondary {
  flex: 1;
  padding-inline: 14px;
  white-space: nowrap;
}
.book-actions .icon-button {
  flex-shrink: 0;
}
</style>

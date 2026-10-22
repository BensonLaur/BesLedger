<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { auth, conflicts, currentLedgerId, ledgers, mutate, run, state, ui, vault } from '../store';
import { list, put, tombstone, type Binding } from '../../domain/model';
import { digest, importKey, parseRecovery } from '../../crypto/vault';
import { downloadLedger, syncLedger } from '../../sync/engine';
import { ledgerProjection, mainStatus, mergeEntities, resolveConflict } from '../../sync/merge';
import { type Repository } from '../../providers/github/client';
import GitHubConnection from '../components/GitHubConnection.vue';
import Modal from '../components/Modal.vue';
import Icon from '../components/Icon.vue';
const bookName = ref(''),
  creating = ref(false),
  renameId = ref(''),
  renameName = ref(''),
  repositories = ref<Repository[]>([]),
  selectedRepo = ref(''),
  repoName = ref('BesLedger-Data'),
  recovery = ref(''),
  keyConfirmed = ref(false),
  status = ref<Record<string, string>>({}),
  conflictLedger = ref(''),
  removing = ref(''),
  deleteCloud = ref('');
let preparedFor = 0;
function knownRepositories(): string[] {
  return Object.values(state.value!.bindings)
    .filter(
      (binding) =>
        binding.userId === auth.value?.user.id &&
        binding.owner.toLowerCase() === auth.value.user.login.toLowerCase(),
    )
    .map((binding) => binding.repo);
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
const cloudOnly = computed(() =>
  Object.entries(state.value!.bindings).filter(([id, b]) => b.remoteExists && !state.value!.entities[id]),
);
const selectedRepository = computed(() => repositories.value.find((r) => r.full_name === selectedRepo.value));
watch(
  state,
  async (s) => {
    if (!s) return;
    const next: Record<string, string> = {};
    for (const book of list(s, 'ledger')) {
      const binding = s.bindings[book.id];
      next[book.id] = mainStatus(
        true,
        !!binding?.remoteExists,
        !binding?.syncedDigest || binding.syncedDigest !== (await digest(ledgerProjection(s, book.id))),
      );
    }
    if (state.value === s) status.value = next;
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
  await run(async () => {
    await mutate((s) => {
      s.preferences.currentLedger = id;
    });
    ui.selectedDay = '';
  });
}
async function getRepos() {
  await run(async () => {
    repositories.value = await auth.value!.github.repositories(knownRepositories());
  });
}
async function prepareCloud() {
  await run(async () => {
    const login = auth.value;
    if (!login) return;
    const repo = await login.github.prepareRepository(knownRepositories());
    if (auth.value?.user.id !== login.user.id) return;
    repositories.value = [repo];
    selectedRepo.value = repo.full_name;
    await discoverContents();
    ui.notice = '云端私有存储已准备好，选择要同步的账本即可';
  });
}
async function createRepo() {
  await run(async () => {
    const repo = await auth.value!.github.createRepository(repoName.value);
    repositories.value = [...repositories.value.filter((r) => r.full_name !== repo.full_name), repo];
    selectedRepo.value = repo.full_name;
    ui.notice = '私有仓库已创建，并已重新读取确认可见性';
  });
}
async function discover() {
  await run(discoverContents);
}
async function discoverContents() {
  const repo = selectedRepository.value;
  if (!repo || !auth.value) throw new Error('请选择自己的私有数据仓库');
  const files = await auth.value.github.discover(repo.owner.login, repo.name, auth.value.user.id);
  await mutate((s) => {
    for (const f of files) {
      const previous = s.bindings[f.id];
      if (previous && (previous.owner !== repo.owner.login || previous.repo !== repo.name))
        throw new Error('发现相同账本身份绑定到其他仓库，请先核对');
      s.bindings[f.id] = {
        ...previous,
        owner: repo.owner.login,
        repo: repo.name,
        userId: auth.value!.user.id,
        remoteExists: true,
        remoteHash: f.sha,
        lastChecked: new Date().toISOString(),
        ...(previous && previous.remoteHash !== f.sha ? { syncedDigest: undefined } : {}),
      };
    }
  });
  ui.notice = `已发现 ${files.length} 个加密账本；名称在解密后可见`;
}
async function key() {
  if (recovery.value.trim()) return importKey(parseRecovery(recovery.value));
  if (!keyConfirmed.value) throw new Error('请选择使用本机恢复密钥，或输入原设备的同步恢复密钥');
  return vault.encryptionKey;
}
async function sync(id: string) {
  await run(async () => {
    if (!auth.value) throw new Error('请先登录 GitHub');
    const previous = state.value!.bindings[id],
      repo = selectedRepository.value;
    const binding: Binding =
      previous ||
      (repo
        ? { owner: repo.owner.login, repo: repo.name, userId: auth.value.user.id, remoteExists: false }
        : (() => {
            throw new Error('首次上传请先选择私有数据仓库');
          })());
    const result = await syncLedger(
      structuredClone(state.value!),
      id,
      binding,
      await key(),
      auth.value.github,
    );
    if (result.conflicts.length) {
      conflicts.value = result.conflicts;
      conflictLedger.value = id;
      ui.notice = '发现冲突，已保留双方版本，尚未上传';
      return;
    }
    await mutate((s) => {
      const merge = mergeEntities(s.entities, result.entities);
      if (merge.conflicts.length) throw new Error('同步期间本机又有修改，请重新同步后处理冲突');
      s.entities = merge.entities;
      s.bindings[id] = result.binding;
      if (s.entities[s.preferences.currentLedger]?.deleted)
        s.preferences.currentLedger = list(s, 'ledger')[0]?.id || '';
    });
    ui.notice = '同步成功，已确认远端完整版本';
  });
}
async function download(id: string) {
  await run(async () => {
    if (!auth.value) throw new Error('请先登录 GitHub');
    const binding = state.value!.bindings[id],
      entities = await downloadLedger(id, binding, await key(), auth.value.github);
    const result = mergeEntities(state.value!.entities, entities);
    if (result.conflicts.length) {
      conflicts.value = result.conflicts;
      conflictLedger.value = id;
      return;
    }
    const contentDigest = await digest(entities);
    await mutate((s) => {
      const latest = mergeEntities(s.entities, entities);
      if (latest.conflicts.length) throw new Error('共用账户存在并发修改，请重新下载处理');
      s.entities = latest.entities;
      s.bindings[id] = { ...binding, syncedDigest: contentDigest, lastChecked: new Date().toISOString() };
      if (!entities[id].deleted) s.preferences.currentLedger = id;
    });
    ui.notice = entities[id].deleted ? '此云端账本已删除，删除标记已同步' : '账本已校验并下载，可离线编辑';
  });
}
async function chooseConflict(id: string, choice: 'local' | 'remote') {
  await run(async () => {
    const c = conflicts.value.find((c) => c.id === id)!;
    await mutate((s) => resolveConflict(s, c, choice));
    conflicts.value = conflicts.value.filter((c) => c.id !== id);
    if (!conflicts.value.length) ui.notice = '冲突已选择，请再次同步以提交解决结果';
  });
}
async function removeLocal() {
  await run(async () => {
    const id = removing.value;
    if (status.value[id] !== '已同步') throw new Error('请先完成同步，不能丢弃待上传修改');
    await mutate((s) => {
      for (const e of Object.values(s.entities))
        if (e.id === id || ('ledgerId' in e.data && e.data.ledgerId === id)) delete s.entities[e.id];
      s.preferences.currentLedger = list(s, 'ledger')[0]?.id || '';
    });
    removing.value = '';
    ui.notice = '已移除本机副本，共用账户定义保留；账户余额范围已变化';
  });
}
async function deleteLedger() {
  await run(async () => {
    const id = deleteCloud.value;
    await mutate((s) => {
      for (const e of Object.values(s.entities))
        if (e.id === id || ('ledgerId' in e.data && e.data.ledgerId === id)) tombstone(s, e.id);
      s.preferences.currentLedger = list(s, 'ledger')[0]?.id || '';
    });
    deleteCloud.value = '';
    ui.notice = '已标记删除，请上传删除标记完成云端删除；备份仍可恢复';
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
    <button class="primary" @click="creating = true"><Icon name="plus" />新建账本</button>
  </div>
  <div class="book-grid">
    <article
      v-for="book in ledgers"
      :key="book.id"
      class="book-card"
      :class="{ selected: currentLedgerId === book.id }"
    >
      <div class="section-heading">
        <span class="entry-icon"><Icon name="book" /></span
        ><span class="tag">{{ status[book.id] || '检查中' }}</span>
      </div>
      <button class="book-name" @click="selectBook(book.id)">
        {{ book.data.name
        }}<small>{{ currentLedgerId === book.id ? '当前账本' : '切换到此账本' }}</small></button
      ><small class="muted">{{
        state!.bindings[book.id]?.lastChecked
          ? '最近确认：' + state!.bindings[book.id].lastChecked!.slice(0, 16).replace('T', ' ') + ' UTC'
          : '尚未确认远端副本'
      }}</small>
      <small v-if="state!.bindings[book.id]" class="muted"
        >绑定：{{ state!.bindings[book.id].owner }}/{{ state!.bindings[book.id].repo }}</small
      >
      <div class="book-actions">
        <button
          class="text-button"
          @click="
            renameId = book.id;
            renameName = book.data.name;
          "
        >
          改名</button
        ><button v-if="auth" class="text-button" :disabled="ui.busy" @click="sync(book.id)">
          {{ state!.bindings[book.id]?.remoteExists ? '同步' : '首次上传' }}</button
        ><button
          v-if="state!.bindings[book.id]?.remoteExists"
          class="text-button"
          @click="removing = book.id"
        >
          移除本机</button
        ><button class="text-button danger-text" @click="deleteCloud = book.id">删除账本</button>
      </div>
    </article>
    <article v-for="[id, binding] in cloudOnly" :key="id" class="book-card cloud-book">
      <span class="tag">仅云端</span>
      <h3>加密账本 · {{ id.slice(-8) }}</h3>
      <p class="hint">{{ binding.owner }}/{{ binding.repo }}</p>
      <button class="primary" :disabled="!auth || ui.busy" @click="download(id)">解密并下载</button>
    </article>
  </div>
  <section v-if="deletedBooks.length" class="card section">
    <h2>已删除账本</h2>
    <div v-for="book in deletedBooks" class="section-heading">
      <span>{{ book.data.kind === 'ledger' ? book.data.name : '' }}</span
      ><button v-if="auth && state!.bindings[book.id]" class="text-button" @click="sync(book.id)">
        同步删除标记
      </button>
    </div>
    <p class="hint">墓碑持续保留，旧设备重连不会静默复活。需要恢复时可使用删除前的备份并处理同步冲突。</p>
  </section>
  <div class="settings-grid section">
    <GitHubConnection />
    <section v-if="auth" class="card">
      <h2>云端私有存储</h2>
      <p v-if="selectedRepo" class="hint">已准备：{{ selectedRepo }}</p>
      <p class="hint">应用自动准备存储，无需输入仓库名称。只有你选择同步的账本密文会上传。</p>
      <button class="secondary" :disabled="ui.busy" @click="prepareCloud">重新检查云端存储</button>
      <details class="section">
        <summary>高级：切换或新建独立数据仓库</summary>
        <button class="secondary" :disabled="ui.busy" @click="getRepos">查找已有账本仓库</button
        ><label
          >数据仓库<select v-model="selectedRepo">
            <option value="">请选择</option>
            <option v-for="r in repositories" :value="r.full_name">{{ r.full_name }}</option>
          </select></label
        ><button class="primary" :disabled="ui.busy || !selectedRepo" @click="discover">发现已有账本</button>
        <form class="inline-form" @submit.prevent="createRepo">
          <input v-model="repoName" aria-label="新私有仓库名称" /><button
            class="secondary"
            :disabled="ui.busy"
          >
            创建私有仓库
          </button>
        </form>
      </details>
      <label
        >原设备的同步恢复密钥（跨端下载时填写）<input
          v-model="recovery"
          type="password"
          autocomplete="off"
          placeholder="64 位恢复密钥" /></label
      ><label class="checkbox"
        ><input v-model="keyConfirmed" type="checkbox" />首次上传使用本机恢复密钥，已独立备份</label
      >
      <p class="hint">
        此密钥不会发送给 GitHub 授权服务。原设备上传使用的恢复密钥是跨端解密凭据；新设备本地解锁口令可不同。
      </p>
    </section>
  </div>
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
      <p class="hint">创建即获得稳定身份，不需要 GitHub 登录。</p>
      <button class="primary full" :disabled="ui.busy">保存</button>
    </form></Modal
  >
  <Modal v-if="conflicts.length" title="同步冲突 · 请选择保留版本" wide @close="conflicts = []"
    ><p>每一项都保留双方内容。选择后再次同步，解决结果才会上传。</p>
    <article v-for="c in conflicts" :key="c.id" class="conflict-card">
      <h3>{{ c.reason }}</h3>
      <div class="form-grid">
        <div>
          <h4>本机 {{ c.local.deleted ? '已删除' : '' }}</h4>
          <pre>{{ JSON.stringify(c.local.data, null, 2) }}</pre>
          <button class="primary" @click="chooseConflict(c.id, 'local')">保留本机</button>
        </div>
        <div>
          <h4>云端 {{ c.remote.deleted ? '已删除' : '' }}</h4>
          <pre>{{ JSON.stringify(c.remote.data, null, 2) }}</pre>
          <button class="secondary" @click="chooseConflict(c.id, 'remote')">保留云端</button>
        </div>
      </div>
    </article>
    <p v-if="ui.error" class="field-error">{{ ui.error }}</p></Modal
  >
  <Modal v-if="removing" title="移除本机副本" @close="removing = ''"
    ><p>仅已同步的账本可以移除。账户定义保留，但本机余额将不再包含该账本流水；可稍后重新下载。</p>
    <button class="danger" :disabled="ui.busy" @click="removeLocal">确认移除本机副本</button></Modal
  >
  <Modal v-if="deleteCloud" title="删除账本及其流水" @close="deleteCloud = ''"
    ><p>
      本机余额与统计会移除该账本的有效流水。共用账户保留。已启用同步的账本需要再同步删除标记，其他设备才会看到删除。
    </p>
    <p>建议先从“我的”导出完整备份。</p>
    <button class="danger" :disabled="ui.busy" @click="deleteLedger">确认标记删除</button></Modal
  >
</template>

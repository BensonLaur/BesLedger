<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { accountBalance } from '../../domain/ledger';
import { list, type Account, type Entity, type State } from '../../domain/model';
import { money } from '../../domain/money';
import { accountIcon, accountKind, accountKinds, balanceLabel } from '../account-presentation';
import { accountAmountsHidden as hidden, toggleAccountAmounts } from '../account-privacy';
import { useEntryViewport } from '../use-entry-viewport';
import Icon from './Icon.vue';
import Modal from './Modal.vue';

const props = defineProps<{
  title: string;
  accounts: Entity<Account>[];
  state: State;
  selected: string;
  emptyHint: string;
}>();
const emit = defineEmits<{ select: [id: string]; add: []; close: [] }>();
const id = useId();
const search = ref('');
const searchInput = ref<HTMLElement>();
const { viewportStyle } = useEntryViewport(searchInput);
const many = computed(() => props.accounts.length >= 6);
const items = computed(() =>
  props.accounts.map((account) => ({ account, balance: accountBalance(props.state, account) })),
);
const filtered = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return items.value.filter(({ account }) =>
    `${account.data.name} ${account.data.bank} ${account.data.tail} ${accountKinds[accountKind(account.data)].name}`
      .toLocaleLowerCase()
      .includes(query),
  );
});
const recentIds = computed(() => {
  // 最近使用来自已保存流水；打开、搜索和取消选择都不会额外写入账本。
  const available = new Set(props.accounts.map((account) => account.id));
  return [
    ...new Set(
      list(props.state, 'entry')
        .sort(
          (a, b) => b.data.createdAt.localeCompare(a.data.createdAt) || b.data.at.localeCompare(a.data.at),
        )
        .flatMap((entry) => [entry.data.from, entry.data.to]),
    ),
  ]
    .filter((accountId) => available.has(accountId))
    .slice(0, 3);
});
const groups = computed(() => {
  if (!many.value) return [{ key: 'all', name: '', items: filtered.value }];
  const recent = search.value.trim()
    ? []
    : recentIds.value.map((accountId) => filtered.value.find(({ account }) => account.id === accountId)!);
  const remaining = filtered.value.filter(
    ({ account }) => !recent.some((item) => item.account.id === account.id),
  );
  return [
    { key: 'recent', name: '最近使用', items: recent },
    ...Object.entries(accountKinds).map(([kind, info]) => ({
      key: kind,
      name: info.name,
      items: remaining.filter(({ account }) => accountKind(account.data) === kind),
    })),
  ].filter((group) => group.items.length);
});
function amount(balance: number) {
  return hidden.value ? '••••••' : money(Math.abs(balance));
}
</script>

<template>
  <Modal :title="title" class="account-picker-backdrop" :style="viewportStyle" @close="emit('close')">
    <template #header>
      <h2>{{ title }}</h2>
      <div class="account-picker-tools">
        <button
          class="icon-button"
          :aria-label="hidden ? '显示金额' : '隐藏金额'"
          :aria-pressed="hidden"
          @click="toggleAccountAmounts"
        >
          <Icon :name="hidden ? 'eye-off' : 'eye'" :size="19" />
        </button>
        <button class="icon-button" aria-label="关闭" @click="emit('close')">
          <Icon name="close" :size="20" />
        </button>
      </div>
    </template>
    <label v-if="many" class="account-picker-search">
      <span class="sr-only">搜索账户</span><Icon name="search" :size="17" />
      <input
        ref="searchInput"
        v-model="search"
        type="search"
        aria-label="搜索账户"
        placeholder="名称、银行或尾号"
        autocomplete="off"
      />
    </label>
    <div class="account-picker-groups">
      <section
        v-for="group in groups"
        :key="group.key"
        class="account-picker-group"
        :aria-label="group.name || '可选账户'"
      >
        <h3 v-if="group.name">{{ group.name }}</h3>
        <button
          v-for="{ account, balance } in group.items"
          :key="account.id"
          type="button"
          class="account-picker-row"
          :class="{ active: selected === account.id }"
          :aria-label="account.data.name"
          :aria-describedby="`${id}-meta-${account.id} ${id}-${account.id}`"
          :aria-pressed="selected === account.id"
          @click="emit('select', account.id)"
        >
          <span class="entry-icon" :class="'account-tone-' + accountKind(account.data)"
            ><Icon :name="accountIcon(account.data)" :size="21"
          /></span>
          <span class="account-picker-name"
            ><strong :title="account.data.name">{{ account.data.name }}</strong>
            <small :id="`${id}-meta-${account.id}`"
              ><span>{{ account.data.bank || accountKinds[accountKind(account.data)].name }}</span
              ><span v-if="account.data.tail">尾号 {{ account.data.tail }}</span></small
            >
          </span>
          <span :id="`${id}-${account.id}`" class="account-picker-value"
            ><strong>{{ amount(balance) }}</strong
            ><small>{{ balanceLabel(account.data, balance) }}</small></span
          >
          <span class="account-picker-check"
            ><Icon v-if="selected === account.id" name="check" :size="18"
          /></span>
        </button>
      </section>
    </div>
    <p v-if="!accounts.length" class="account-picker-empty">{{ emptyHint }}</p>
    <p v-else-if="!filtered.length" class="account-picker-empty">没有找到这个账户，试试名称、银行或尾号。</p>
    <template #footer>
      <button class="text-button account-picker-add" @click="emit('add')">
        <Icon name="plus" :size="18" />添加账户
      </button>
    </template>
  </Modal>
</template>

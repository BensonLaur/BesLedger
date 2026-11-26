<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue';
import { categories } from '../../domain/categories';
import { list, type Entry, type State } from '../../domain/model';
import { decimal, money } from '../../domain/money';
import type { Recognition } from '../../recognition/sms';
import {
  recognitionPreview,
  reviewAmount,
  type RecognitionProtection,
  type ReviewedRecognition,
} from '../recognition-review';
import { useEntryViewport } from '../use-entry-viewport';
import { accountAmountsHidden } from '../account-privacy';
import Modal from './Modal.vue';
import Icon from './Icon.vue';
import AccountPicker from './AccountPicker.vue';
import EntryDateTimePicker from './EntryDateTimePicker.vue';

const props = defineProps<{
  result: Recognition;
  draft: Entry;
  amount: string;
  automatic: boolean;
  protectedFields: RecognitionProtection;
  state: State;
}>();
const emit = defineEmits<{ apply: [value: ReviewedRecognition]; keep: []; close: []; addAccount: [] }>();
// 选项先留在本面板，明确采用才写回草稿；关闭、返回和“保留我的填写”均可安全退出。
const choice = reactive(
  recognitionPreview(
    props.result,
    props.draft,
    props.amount,
    props.automatic,
    props.protectedFields,
    props.state,
  ),
);
const amountInput = ref(choice.amount === undefined ? '' : decimal(choice.amount));
const amountIndex = ref(props.result.amountIndex);
const root = ref<HTMLElement>(),
  amountElement = ref<HTMLInputElement>();
const { viewportStyle } = useEntryViewport(root);
const categoryOpen = ref(false),
  categorySearch = ref(''),
  accountOpen = ref(false),
  dateOpen = ref(false),
  error = ref('');
const typeLabel = computed(
  () =>
    ({
      expense: '支出',
      income: '收入',
      refund: '退款',
      transfer: '转账',
      borrow: '借入',
      lend: '借出',
      repay: '还款',
      collect: '收款',
    })[choice.type],
);
const withCategory = computed(() => ['expense', 'income'].includes(choice.type));
const allCategories = computed(() =>
  categories(props.state, props.draft.ledgerId).filter(
    (category) => category.type === (choice.type === 'income' ? 'income' : 'expense'),
  ),
);
const categoryName = computed(
  () => allCategories.value.find((category) => category.id === choice.categoryId)?.name || '未识别',
);
const filteredCategories = computed(() =>
  allCategories.value.filter((category) =>
    `${category.group}${category.name}`.includes(categorySearch.value.trim()),
  ),
);
const categoryGroups = computed(() => [
  ...new Set(filteredCategories.value.map((category) => category.group)),
]);
const categoryCandidates = computed(() =>
  allCategories.value.filter((category) => props.result.categoryIds.includes(category.id)),
);
const loan = computed(() => ['borrow', 'lend', 'repay', 'collect'].includes(choice.type));
const counterpart = computed(() => (['borrow', 'collect'].includes(choice.type) ? 'from' : 'to'));
const accounts = computed(() =>
  list(props.state, 'account').filter(
    (account) =>
      !loan.value ||
      (choice.side === counterpart.value
        ? account.data.type === 'receivable'
        : account.data.type !== 'receivable'),
  ),
);
const account = computed(() => accounts.value.find((account) => account.id === choice.accountId));
const accountCandidates = computed(() =>
  accounts.value.filter((account) => props.result.accountIds.includes(account.id)),
);
const accountTitle = computed(() =>
  loan.value && choice.side === counterpart.value
    ? '选择往来方'
    : choice.side === 'from'
      ? '选择付款账户'
      : '选择收款账户',
);
const amountProtected = computed(
  () => props.automatic && props.protectedFields.amount && !choice.changed.amount,
);
const categoryProtected = computed(
  () => props.automatic && props.protectedFields.category && !choice.changed.category,
);
const timeProtected = computed(() => props.automatic && props.protectedFields.at && !choice.changed.at);
const accountProtected = computed(
  () => props.automatic && props.protectedFields[choice.side] && !choice.changed.account,
);
const needsAmountChoice = computed(
  () =>
    !amountProtected.value &&
    props.result.amountCandidates.length > 1 &&
    amountIndex.value === undefined &&
    !choice.changed.amount,
);
const inferredUnit = computed(
  () =>
    !amountProtected.value &&
    !props.result.amountCertain &&
    props.result.amount !== undefined &&
    !choice.changed.amount,
);
const needsYear = computed(
  () =>
    !!props.result.at &&
    props.result.yearBasis !== 'explicitText' &&
    !timeProtected.value &&
    !choice.changed.at,
);
const yearChecked = ref(false);
const ambiguousDate = computed(
  () => props.result.dateAmbiguous && !choice.changed.at && !timeProtected.value,
);
const invalidDate = computed(
  () =>
    props.result.warnings.some((warning) => warning.includes('日期无效')) &&
    !choice.changed.at &&
    !timeProtected.value,
);
const futureDate = computed(
  () =>
    props.result.warnings.some((warning) => warning.includes('时间晚于今天')) &&
    !choice.changed.at &&
    !timeProtected.value,
);
const ambiguousAccount = computed(
  () =>
    accountCandidates.value.length > 1 &&
    !choice.changed.account &&
    !accountProtected.value &&
    !props.protectedFields[choice.side],
);
const tasks = computed(() =>
  [
    (!reviewAmount(amountInput.value) || needsAmountChoice.value || inferredUnit.value) && '金额',
    withCategory.value && !choice.categoryId && '分类',
    ((needsYear.value && !yearChecked.value) ||
      ambiguousDate.value ||
      invalidDate.value ||
      futureDate.value) &&
      '时间',
    (!account.value || ambiguousAccount.value) && '账户',
  ].filter(Boolean),
);
// 会改变交易含义的警告不能藏进折叠说明；来源、推荐依据及重复的缺项说明按需展开。
const criticalWarnings = computed(() =>
  props.result.warnings.filter((warning) => /其他币种|未完成的交易|转账或借还|退款需选择/.test(warning)),
);
const primaryLabel = computed(() =>
  !reviewAmount(amountInput.value)
    ? '填写金额'
    : needsAmountChoice.value
      ? '选择本次金额'
      : withCategory.value && !choice.categoryId
        ? '选择分类'
        : !account.value || ambiguousAccount.value
          ? '选择账户'
          : props.automatic
            ? '完成核对'
            : '采用并返回',
);
function selectAmount(index: number) {
  const candidate = props.result.amountCandidates[index];
  if (!candidate) return;
  amountInput.value = decimal(candidate.amount);
  amountIndex.value = index;
  choice.changed.amount = true;
  error.value = '';
}
function selectCategory(id: string) {
  choice.categoryId = id;
  choice.changed.category = true;
  categoryOpen.value = false;
  error.value = '';
  void nextTick(() => root.value?.parentElement?.scrollTo(0, 0));
}
function setDate(value: string) {
  choice.at = value;
  choice.changed.at = true;
  yearChecked.value = true;
  dateOpen.value = false;
  error.value = '';
}
function close() {
  if (categoryOpen.value) categoryOpen.value = false;
  else emit('close');
}
async function apply() {
  const amount = reviewAmount(amountInput.value);
  if (amount === undefined || needsAmountChoice.value) {
    error.value = amount === undefined ? '请填写有效的本次金额' : '请选择本次实际金额，或直接填写';
    await nextTick();
    amountElement.value?.focus();
    return;
  }
  if (withCategory.value && !choice.categoryId) {
    categoryOpen.value = true;
    return;
  }
  if (!account.value || ambiguousAccount.value) {
    accountOpen.value = true;
    return;
  }
  // 采用是对已展示的年份/单位/时间的明确确认；仍可在字段旁单独确认或修改。
  emit('apply', { ...choice, amount, changed: { ...choice.changed } });
}
</script>

<template>
  <Modal title="备注识别结果" class="recognition-review-backdrop" :style="viewportStyle" @close="close">
    <div ref="root" class="recognition-panel recognition-review">
      <template v-if="categoryOpen">
        <button type="button" class="text-button review-category-back" @click="categoryOpen = false">
          <Icon name="left" :size="17" />返回核对
        </button>
        <label class="review-category-search"
          ><span class="sr-only">搜索分类</span
          ><input v-model="categorySearch" type="search" aria-label="搜索分类" placeholder="搜索分类"
        /></label>
        <section v-for="group in categoryGroups" :key="group" class="review-category-group">
          <h3>{{ group }}</h3>
          <div>
            <button
              v-for="category in filteredCategories.filter((category) => category.group === group)"
              :key="category.id"
              type="button"
              :aria-pressed="choice.categoryId === category.id"
              @click="selectCategory(category.id)"
            >
              <Icon :name="category.icon" :size="18" />{{ category.name }}
            </button>
          </div>
        </section>
        <p v-if="!filteredCategories.length" class="hint">没有找到这个分类，试试其他名称。</p>
      </template>
      <template v-else>
        <div class="review-amount">
          <div>
            <span class="review-type">{{ typeLabel }}</span
            ><span class="review-amount-state">{{
              amountProtected
                ? '保留手填金额'
                : needsAmountChoice
                  ? '请选择本次金额'
                  : inferredUnit
                    ? '按元识别，请核对'
                    : result.amount === undefined && !choice.changed.amount
                      ? amountInput
                        ? '沿用已填金额'
                        : '未识别金额'
                      : '识别金额'
            }}</span>
          </div>
          <label
            ><span>¥</span
            ><input
              ref="amountElement"
              v-model="amountInput"
              aria-label="本次金额"
              inputmode="decimal"
              placeholder="填写金额"
              autocomplete="off"
              @input="
                choice.changed.amount = true;
                amountIndex = undefined;
                error = '';
              " /><Icon name="edit" :size="17"
          /></label>
          <div v-if="result.amountCandidates.length > 1" class="review-candidates review-amount-candidates">
            <button
              v-for="(candidate, index) in result.amountCandidates"
              :key="index"
              type="button"
              :aria-pressed="amountIndex === index"
              @click="selectAmount(index)"
            >
              {{ candidate.text }} · ¥ {{ money(candidate.amount) }}
            </button>
          </div>
          <p
            v-if="
              result.warnings.some((warning) => warning.includes('精度或正负号')) && !choice.changed.amount
            "
            class="review-inline-warning"
          >
            原文金额格式不明确，请核对或填写。
          </p>
        </div>
        <p v-if="tasks.length" class="review-task-heading">
          还有 {{ tasks.length }} 项待核对<span>{{ tasks.join('、') }}</span>
        </p>
        <p v-for="warning in criticalWarnings" :key="warning" class="review-critical">{{ warning }}</p>
        <div class="review-fields">
          <section v-if="withCategory" class="review-field" :class="{ pending: !choice.categoryId }">
            <span class="review-field-label">分类</span>
            <div>
              <strong>{{ categoryName }}</strong
              ><small v-if="categoryProtected">保留手动选择</small
              ><small v-else-if="!choice.categoryId">请选择分类</small>
            </div>
            <button type="button" class="text-button" @click="categoryOpen = true">
              {{ choice.categoryId ? '修改分类' : '选择分类' }}
            </button>
            <div v-if="categoryCandidates.length > 1" class="review-candidates">
              <button
                v-for="category in categoryCandidates"
                :key="category.id"
                type="button"
                :aria-pressed="choice.categoryId === category.id"
                @click="selectCategory(category.id)"
              >
                {{ category.name }}
              </button>
            </div>
          </section>
          <section
            class="review-field"
            :class="{ pending: (needsYear && !yearChecked) || ambiguousDate || invalidDate || futureDate }"
          >
            <span class="review-field-label">时间</span>
            <div>
              <strong>{{ choice.at.slice(0, 16).replace('T', ' ') }}</strong
              ><small v-if="timeProtected">保留手动时间</small
              ><small v-else-if="ambiguousDate">多个时间，请核对</small
              ><small v-else-if="invalidDate">原文日期无效，沿用填写时间</small
              ><small v-else-if="needsYear">{{ yearChecked ? '年份已确认' : '年份待确认' }}</small
              ><small v-else-if="futureDate">晚于今天，请核对</small
              ><small v-else-if="!result.at">沿用填写时间</small>
            </div>
            <button type="button" class="text-button" @click="dateOpen = true">修改时间</button>
            <button
              v-if="needsYear && !yearChecked"
              type="button"
              class="review-year-confirm"
              @click="yearChecked = true"
            >
              确认 {{ choice.at.slice(0, 4) }} 年
            </button>
          </section>
          <section class="review-field" :class="{ pending: !account || ambiguousAccount }">
            <span class="review-field-label">{{ choice.side === 'from' ? '付款' : '收款' }}</span>
            <div>
              <strong>{{ account?.data.name || '未选择账户' }}</strong
              ><small
                >{{ account?.data.tail ? '尾号 ' + account.data.tail + ' · ' : ''
                }}{{
                  accountProtected
                    ? '保留已选账户'
                    : ambiguousAccount
                      ? '匹配多个账户，请选择'
                      : result.accountIds.length === 1 && account && result.accountIds[0] === choice.accountId
                        ? automatic && draft[choice.side] === choice.accountId
                          ? '已自动选用'
                          : '已匹配，采用后选用'
                        : account
                          ? '沿用已选账户'
                          : '请选择账户'
                }}</small
              >
            </div>
            <button type="button" class="text-button" @click="accountOpen = true">
              {{ account ? '更换账户' : '选择账户' }}
            </button>
            <div v-if="accountCandidates.length > 1" class="review-candidates">
              <button
                v-for="candidate in accountCandidates"
                :key="candidate.id"
                type="button"
                :aria-pressed="choice.accountId === candidate.id"
                @click="
                  choice.accountId = candidate.id;
                  choice.changed.account = true;
                "
              >
                {{ candidate.data.name }}
              </button>
            </div>
          </section>
        </div>
        <details class="review-details">
          <summary>识别详情<Icon name="down" :size="15" /></summary>
          <p>
            识别金额 {{ result.amount === undefined ? '未识别' : '¥ ' + money(result.amount) }} ·
            {{
              result.type ? { expense: '支出', income: '收入', refund: '退款' }[result.type] : '沿用当前类型'
            }}
          </p>
          <p v-if="result.amountSource">金额依据：{{ result.amountSource }}</p>
          <p v-if="result.rawDate">原文时间：{{ result.rawDate }}</p>
          <p v-for="warning in result.warnings" :key="warning">{{ warning }}</p>
          <p v-if="result.balance !== undefined">
            备注中的余额 ¥
            {{ accountAmountsHidden ? '••••••' : money(result.balance) }} 仅供核对，不会覆盖账户余额。
          </p>
        </details>
      </template>
    </div>
    <template #footer>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <div v-if="!categoryOpen" class="review-actions">
        <button type="button" class="secondary" @click="emit('keep')">保留我的填写</button
        ><button type="button" class="primary" @click="apply">{{ primaryLabel }}</button>
      </div>
      <button v-else type="button" class="secondary full" @click="categoryOpen = false">返回核对</button>
    </template>
  </Modal>
  <AccountPicker
    v-if="accountOpen"
    :title="accountTitle"
    :accounts="accounts"
    :state="state"
    :selected="choice.accountId"
    empty-hint="先添加一个账户，再继续核对。"
    @select="
      choice.accountId = $event;
      choice.changed.account = true;
      accountOpen = false;
      error = '';
    "
    @close="accountOpen = false"
    @add="emit('addAccount')"
  />
  <EntryDateTimePicker v-if="dateOpen" :value="choice.at" @confirm="setDate" @close="dateOpen = false" />
</template>

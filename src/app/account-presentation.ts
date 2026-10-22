import type { Account } from '../domain/model';

export const accountKinds = {
  cash: {
    type: 'cash',
    name: '现金',
    hint: '随身现金、备用金',
    icon: 'banknote',
    placeholder: '例如：随身现金',
  },
  credit: {
    type: 'credit',
    name: '信用卡',
    hint: '消费欠款、还款与退款',
    icon: 'credit-card',
    placeholder: '例如：日常信用卡',
  },
  bank: {
    type: 'bank',
    name: '储蓄卡 / 借记卡',
    hint: '工资卡、日常消费银行卡',
    icon: 'landmark',
    placeholder: '例如：常用储蓄卡',
  },
  wallet: {
    type: 'wallet',
    name: '网络账户',
    hint: '微信零钱、支付宝余额',
    icon: 'wallet',
    placeholder: '例如：微信零钱',
  },
  investment: {
    type: 'asset',
    name: '投资账户',
    hint: '证券账户、基金账户',
    icon: 'chart-no-axes-combined',
    placeholder: '例如：基金账户',
  },
  receivable: {
    type: 'receivable',
    name: '应收 / 应付',
    hint: '别人欠我的钱、我欠别人的钱',
    icon: 'hand-coins',
    placeholder: '例如：朋友甲',
  },
  stored: {
    type: 'wallet',
    name: '储值卡',
    hint: '购物卡、公交卡、饭卡',
    icon: 'tickets',
    placeholder: '例如：食堂饭卡',
  },
  other: {
    type: 'asset',
    name: '其他账户',
    hint: '公积金等其他资金，或一笔欠款',
    icon: 'sliders-horizontal',
    placeholder: '例如：公积金',
  },
} as const;
export type AccountKind = keyof typeof accountKinds;
export function accountKind(account: Account): AccountKind {
  if (account.displayType) return account.displayType;
  return account.type === 'asset' || account.type === 'liability' ? 'other' : account.type;
}
export function accountIcon(account: Account): string {
  return accountKinds[accountKind(account)].icon;
}
export function balanceLabel(account: Account, balance: number): string {
  if (account.type === 'receivable') return balance < 0 ? '我欠别人' : '别人欠我';
  if (account.type === 'credit') return balance > 0 ? '卡内余款' : '待还款';
  return balance < 0 ? '欠款' : '余额';
}

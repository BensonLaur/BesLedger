import { expect, type Locator } from '@playwright/test';

/** 滚动真实滚轮 DOM，沿用和手势相同的 scroll 事件，不绕过表单写草稿。 */
export async function chooseTimeWheel(dialog: Locator, label: string, value: string) {
  const wheel = dialog.getByRole('spinbutton', { name: label, exact: true });
  await wheel.evaluate((element, value) => {
    const options = [...element.querySelectorAll<HTMLElement>('.wheel-option')];
    const matches = options
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => option.dataset.value === value);
    const target = matches[Math.floor(matches.length / 2)];
    if (!target) throw new Error(`滚轮选项不存在：${value}`);
    element.scrollTop =
      target.index * Number.parseFloat(getComputedStyle(element).getPropertyValue('--wheel-row'));
    element.dispatchEvent(new Event('scroll'));
  }, value);
  if (label !== '日期')
    await expect(wheel).toHaveAttribute(
      'aria-valuetext',
      new RegExp(value.padStart(label === '小时' || label === '分钟' ? 2 : 1, '0')),
    );
}

export async function setEntryTime(dialog: Locator, value: string) {
  const [year, month, day, hour, minute] = value.split(/[-T:]/).map(Number);
  await dialog.getByRole('tab', { name: '日期', exact: true }).click();
  await chooseTimeWheel(dialog, '年', String(year));
  await chooseTimeWheel(dialog, '月', String(month));
  await chooseTimeWheel(dialog, '日', String(day));
  await dialog.getByRole('tab', { name: '时间', exact: true }).click();
  await chooseTimeWheel(dialog, '小时', String(hour));
  await chooseTimeWheel(dialog, '分钟', String(minute));
  await expect(dialog.getByLabel('已选时间')).toHaveText(value.slice(0, 16).replace('T', ' '));
}

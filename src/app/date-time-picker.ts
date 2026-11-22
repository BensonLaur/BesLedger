import { dayAdd, localTime, validTime } from '../domain/time';

export type PickerDate = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};
export type WheelOption = { value: string; label: string };
const pad = (value: number) => String(value).padStart(2, '0');

export function pickerDate(value: string): PickerDate {
  const normalized = value.length === 16 ? `${value}:00` : value;
  const source = validTime(normalized) ? normalized : localTime();
  const [year, month, day, hour, minute, second] = source.split(/[-T:]/).map(Number);
  return { year, month, day, hour, minute, second };
}

export function pickerValue(date: PickerDate): string {
  return `${String(date.year).padStart(4, '0')}-${pad(date.month)}-${pad(date.day)}T${pad(date.hour)}:${pad(date.minute)}:${pad(date.second)}`;
}

export function daysInPickerMonth(year: number, month: number) {
  // UTC 构造不会跨本地时区；setUTCFullYear 避免 1–99 年被 Date 自动解释为 1900 年代。
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

export function changePickerDate(date: PickerDate, part: keyof PickerDate, value: number): PickerDate {
  const next = { ...date, [part]: value };
  next.day = Math.min(next.day, daysInPickerMonth(next.year, next.month));
  // 手动修改时分按分钟记账；只改日期时保留短信中已有的秒数。
  if (part === 'hour' || part === 'minute') next.second = 0;
  return next;
}

export function nearbyPickerDays(day: string, count = 183, today = localTime().slice(0, 10)): WheelOption[] {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return Array.from({ length: count * 2 + 1 }, (_, index) => {
    const value = dayAdd(day, index - count);
    const date = new Date(`${value}T12:00:00+08:00`);
    return {
      value,
      label:
        value === today
          ? '今天'
          : `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日 ${weekdays[date.getUTCDay()]}`,
    };
  }).filter((option) => /^\d{4}-/.test(option.value));
}

export function numberOptions(start: number, end: number, suffix = '', padded = false): WheelOption[] {
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const value = start + index;
    return { value: String(value), label: `${padded ? pad(value) : value}${suffix}` };
  });
}

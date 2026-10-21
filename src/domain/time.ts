const formatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
export function localTime(now: Date = new Date()): string {
  return formatter.format(now).replace(' ', 'T');
}
export function today(now: Date = new Date()): string {
  return localTime(now).slice(0, 10);
}
export function validTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(`${value}+08:00`);
  return !Number.isNaN(date.valueOf()) && localTime(date) === value;
}
export function draftTime(selectedDay?: string, now = new Date()): string {
  // 仅新建草稿读取时钟；历史整月没有选中日，仍使用当前时刻。
  return selectedDay && selectedDay !== today(now) ? `${selectedDay}T12:00:00` : localTime(now);
}
export function dayAdd(day: string, count: number): string {
  return today(new Date(new Date(`${day}T12:00:00+08:00`).valueOf() + count * 86400000));
}
export function monthDate(month: string, day: number): string {
  const [year, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

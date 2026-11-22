import { describe, expect, it } from 'vitest';
import {
  changePickerDate,
  daysInPickerMonth,
  nearbyPickerDays,
  pickerDate,
  pickerValue,
} from '../src/app/date-time-picker';

describe('记账时间滚轮的日期约束', () => {
  it.each([
    [2024, 29],
    [2026, 28],
    [2000, 29],
    [1900, 28],
  ])('二月天数 %i', (year, days) => {
    expect(daysInPickerMonth(year, 2)).toBe(days);
  });
  it('切换短月和闰年时收敛日，不自动跨月；仅改日期保留秒', () => {
    const source = pickerDate('2024-01-31T08:09:17');
    const february = changePickerDate(source, 'month', 2);
    expect(pickerValue(february)).toBe('2024-02-29T08:09:17');
    expect(pickerValue(changePickerDate(february, 'year', 2025))).toBe('2025-02-28T08:09:17');
    expect(pickerValue(source)).toBe('2024-01-31T08:09:17');
  });
  it('分钟精度手调重置秒，午夜合法且年月日保持', () => {
    const date = changePickerDate(
      changePickerDate(pickerDate('2026-12-31T23:59:47'), 'hour', 0),
      'minute',
      0,
    );
    expect(pickerValue(date)).toBe('2026-12-31T00:00:00');
    expect(pickerValue(pickerDate('2026-11-22T12:30'))).toBe('2026-11-22T12:30:00');
  });
  it('邻近日跨年、闰日与今天标签按上海日期生成', () => {
    expect(nearbyPickerDays('2026-12-31', 1, '2027-01-01')).toEqual([
      { value: '2026-12-30', label: '12月30日 周三' },
      { value: '2026-12-31', label: '12月31日 周四' },
      { value: '2027-01-01', label: '今天' },
    ]);
    expect(nearbyPickerDays('2024-03-01', 1).map((option) => option.value)).toEqual([
      '2024-02-29',
      '2024-03-01',
      '2024-03-02',
    ]);
  });
});

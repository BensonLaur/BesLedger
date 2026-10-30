import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('识别开关默认手动，只保存一个不含账目的本地偏好，并能在重新加载后恢复', async () => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
  const first = await import('../src/app/recognition-mode');
  expect(first.readAutoRecognition()).toBe(false);
  expect(first.rememberAutoRecognition(true)).toBe(true);
  vi.resetModules();
  const reloaded = await import('../src/app/recognition-mode');
  expect(reloaded.readAutoRecognition()).toBe(true);
  expect([...data.values()]).toEqual(['auto']);
  reloaded.rememberAutoRecognition(false);
  expect([...data.values()]).toEqual(['manual']);
});
it('本地偏好存储被禁用时仍可本次切换，不抛异常或接触账本存储', async () => {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  });
  const mode = await import('../src/app/recognition-mode');
  expect(mode.readAutoRecognition()).toBe(false);
  expect(mode.rememberAutoRecognition(true)).toBe(false);
  expect(mode.readAutoRecognition()).toBe(true);
  mode.rememberAutoRecognition(false);
  expect(mode.readAutoRecognition()).toBe(false);
});

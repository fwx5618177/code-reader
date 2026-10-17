import { beforeEach, describe, expect, it } from 'vitest';
import {
  clampReadingSetting,
  DEFAULT_READING_SETTINGS,
  loadReadingSettings,
  normalizeReadingSettings,
  READING_SETTINGS_STORAGE_KEY,
  saveReadingSettings,
} from '../reading-settings';

describe('reading-settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('数值限制在范围内并对齐步长', () => {
    expect(clampReadingSetting('fontSize', 100)).toBe(26);
    expect(clampReadingSetting('fontSize', 2)).toBe(13);
    expect(clampReadingSetting('lineHeight', 1.8 + 0.1)).toBe(1.9);
    expect(clampReadingSetting('lineWidth', 735)).toBe(720);
    expect(clampReadingSetting('lineWidth', NaN)).toBe(DEFAULT_READING_SETTINGS.lineWidth);
  });

  it('非法字段回退为默认值', () => {
    expect(normalizeReadingSettings(null)).toEqual(DEFAULT_READING_SETTINGS);
    expect(normalizeReadingSettings({ fontFamily: 'comic', fontSize: '20', lineHeight: 2 })).toEqual({
      ...DEFAULT_READING_SETTINGS,
      lineHeight: 2,
    });
  });

  it('保存后可读回；存储内容损坏时使用默认值', () => {
    const settings = { fontFamily: 'sans' as const, fontSize: 20, lineWidth: 880, lineHeight: 2.1 };
    saveReadingSettings(settings);
    expect(loadReadingSettings()).toEqual(settings);

    localStorage.setItem(READING_SETTINGS_STORAGE_KEY, '{broken');
    expect(loadReadingSettings()).toEqual(DEFAULT_READING_SETTINGS);
  });
});

// ================================
// 阅读排版设置
// 字体、字号、行宽、行高，整体保存在 localStorage 的单个键中
// ================================

export type ReadingFontFamily = 'serif' | 'sans';

export interface ReadingSettings {
  fontFamily: ReadingFontFamily;
  /** 字号（px） */
  fontSize: number;
  /** 正文最大行宽（px） */
  lineWidth: number;
  /** 行高（倍数） */
  lineHeight: number;
}

/** 可调节的数值项 */
export type ReadingNumericSetting = Exclude<keyof ReadingSettings, 'fontFamily'>;

export const READING_SETTINGS_STORAGE_KEY = 'reading-settings';

export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  fontFamily: 'serif',
  fontSize: 17,
  lineWidth: 720,
  lineHeight: 1.8,
};

/** 数值项的范围与步长 */
export const READING_SETTING_LIMITS: Record<
  ReadingNumericSetting,
  { min: number; max: number; step: number }
> = {
  fontSize: { min: 13, max: 26, step: 1 },
  lineWidth: { min: 520, max: 1080, step: 40 },
  lineHeight: { min: 1.4, max: 2.4, step: 0.1 },
};

/**
 * 将数值限制在范围内，并对齐到步长（避免浮点累积误差）
 */
export function clampReadingSetting(key: ReadingNumericSetting, value: number): number {
  const { min, max, step } = READING_SETTING_LIMITS[key];
  if (!Number.isFinite(value)) return DEFAULT_READING_SETTINGS[key];
  const stepped = Math.round((value - min) / step) * step + min;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(2));
}

/**
 * 规范化任意输入为合法设置；缺失或非法字段使用默认值
 */
export function normalizeReadingSettings(raw: unknown): ReadingSettings {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const numeric = (key: ReadingNumericSetting): number =>
    typeof source[key] === 'number'
      ? clampReadingSetting(key, source[key] as number)
      : DEFAULT_READING_SETTINGS[key];

  return {
    fontFamily: source.fontFamily === 'sans' || source.fontFamily === 'serif'
      ? source.fontFamily
      : DEFAULT_READING_SETTINGS.fontFamily,
    fontSize: numeric('fontSize'),
    lineWidth: numeric('lineWidth'),
    lineHeight: numeric('lineHeight'),
  };
}

export function loadReadingSettings(storage: Storage = localStorage): ReadingSettings {
  try {
    const stored = storage.getItem(READING_SETTINGS_STORAGE_KEY);
    return normalizeReadingSettings(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_READING_SETTINGS };
  }
}

export function saveReadingSettings(settings: ReadingSettings, storage: Storage = localStorage): void {
  storage.setItem(READING_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

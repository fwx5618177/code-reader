// ================================
// 写作页面设置
// 纸张背景、页宽、正文字体/字号/行距、打字机模式，整体保存在 localStorage 的单个键中；
// 写作模式与专注模式的编辑区共用同一份设置
// ================================

export type PageBackground = 'none' | 'lines' | 'grid' | 'dots';
export type PageContentWidth = 'narrow' | 'medium' | 'wide' | 'full';
export type PageFontFamily = 'sans' | 'serif';

export interface PageSettings {
  /** 纸张背景 */
  background: PageBackground;
  /** 背景线条浓度（0.1-1） */
  ruleOpacity: number;
  /** 正文页宽 */
  contentWidth: PageContentWidth;
  fontFamily: PageFontFamily;
  /** 正文字号（px） */
  fontSize: number;
  /** 行距（字号的倍数） */
  lineHeight: number;
  /** 打字机模式：光标所在行保持在编辑区垂直中央 */
  typewriter: boolean;
}

/** 可调节的数值项 */
export type PageNumericSetting = 'ruleOpacity' | 'fontSize' | 'lineHeight';

export const PAGE_SETTINGS_STORAGE_KEY = 'writing-page-settings';

export const PAGE_BACKGROUNDS: readonly PageBackground[] = ['none', 'lines', 'grid', 'dots'];
export const PAGE_CONTENT_WIDTHS: readonly PageContentWidth[] = ['narrow', 'medium', 'wide', 'full'];
export const PAGE_FONT_FAMILIES: readonly PageFontFamily[] = ['sans', 'serif'];

/** 页宽对应的正文最大宽度（作为编辑器 contentMaxWidth） */
export const PAGE_CONTENT_WIDTH_VALUES: Record<PageContentWidth, string> = {
  narrow: '560px',
  medium: '720px',
  wide: '900px',
  full: '100%',
};

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  background: 'none',
  ruleOpacity: 0.4,
  contentWidth: 'medium',
  fontFamily: 'sans',
  fontSize: 16,
  lineHeight: 1.75,
  typewriter: false,
};

/** 数值项的范围与步长 */
export const PAGE_SETTING_LIMITS: Record<PageNumericSetting, { min: number; max: number; step: number }> =
  {
    ruleOpacity: { min: 0.1, max: 1, step: 0.1 },
    fontSize: { min: 12, max: 24, step: 1 },
    lineHeight: { min: 1.4, max: 2.4, step: 0.05 },
  };

/**
 * 将数值限制在范围内并对齐到步长（避免浮点累积误差）；非有限数回退默认值
 */
export function clampPageSetting(key: PageNumericSetting, value: number): number {
  const { min, max, step } = PAGE_SETTING_LIMITS[key];
  if (!Number.isFinite(value)) return DEFAULT_PAGE_SETTINGS[key];
  const stepped = Math.round((value - min) / step) * step + min;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(2));
}

function pick<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/**
 * 规范化任意输入为合法设置；缺失或非法字段使用默认值
 */
export function normalizePageSettings(raw: unknown): PageSettings {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const numeric = (key: PageNumericSetting): number =>
    typeof source[key] === 'number'
      ? clampPageSetting(key, source[key] as number)
      : DEFAULT_PAGE_SETTINGS[key];

  return {
    background: pick(source.background, PAGE_BACKGROUNDS, DEFAULT_PAGE_SETTINGS.background),
    ruleOpacity: numeric('ruleOpacity'),
    contentWidth: pick(source.contentWidth, PAGE_CONTENT_WIDTHS, DEFAULT_PAGE_SETTINGS.contentWidth),
    fontFamily: pick(source.fontFamily, PAGE_FONT_FAMILIES, DEFAULT_PAGE_SETTINGS.fontFamily),
    fontSize: numeric('fontSize'),
    lineHeight: numeric('lineHeight'),
    typewriter:
      typeof source.typewriter === 'boolean' ? source.typewriter : DEFAULT_PAGE_SETTINGS.typewriter,
  };
}

/** 合并局部修改并校验 */
export function mergePageSettings(current: PageSettings, patch: Partial<PageSettings>): PageSettings {
  return normalizePageSettings({ ...current, ...patch });
}

/**
 * 正文行高（整数 px）：横线/方格的间距与之相同，
 * 取整后正文 line-height 直接使用该值，保证文字行与背景线逐行对齐、不累积误差
 */
export function pageLinePx(settings: PageSettings): number {
  return Math.round(settings.fontSize * settings.lineHeight);
}

/**
 * 页面设置对应的 CSS 变量，由 PageSurface 写到编辑区外层，编辑器样式读取
 */
export function buildPageStyleVars(settings: PageSettings): Record<string, string> {
  return {
    '--page-font-size': `${settings.fontSize}px`,
    '--page-line': `${pageLinePx(settings)}px`,
    '--page-rule-opacity': String(settings.ruleOpacity),
    '--page-content-width': PAGE_CONTENT_WIDTH_VALUES[settings.contentWidth],
  };
}

export function loadPageSettings(storage: Storage = localStorage): PageSettings {
  try {
    const stored = storage.getItem(PAGE_SETTINGS_STORAGE_KEY);
    return normalizePageSettings(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_PAGE_SETTINGS };
  }
}

export function savePageSettings(settings: PageSettings, storage: Storage = localStorage): void {
  storage.setItem(PAGE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

// ================================
// 插件主题（声明式）
// 主题只覆盖界面颜色变量，不执行插件代码：变量名限定为下列颜色变量，值限定为颜色字面量
// （#rgb / #rrggbb / #rrggbbaa、rgb()/rgba()、hsl()/hsla()），杜绝 url()、expression 等注入。
// 选中的主题以「<插件 ID>/<主题 ID>」记在外观设置中；插件停用或卸载后自动回到内置配色
// ================================

import type { PluginId, PluginTheme } from './types';

/** 主题可以覆盖的颜色变量（与 theme-config 生成的颜色变量一致） */
export const THEME_COLOR_VARIABLES = [
  '--bg-canvas',
  '--bg-primary',
  '--bg-secondary',
  '--bg-tertiary',
  '--bg-quaternary',
  '--bg-hover',
  '--bg-active',
  '--bg-selected',
  '--bg-highlight',
  '--border-primary',
  '--border-secondary',
  '--border-subtle',
  '--border-focus',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--text-faint',
  '--text-accent',
  '--text-on-accent',
  '--accent-primary',
  '--accent-primary-hover',
  '--accent-primary-active',
  '--accent-secondary',
  '--color-success',
  '--color-success-bg',
  '--color-warning',
  '--color-warning-bg',
  '--color-error',
  '--color-error-bg',
  '--color-info',
  '--color-info-bg',
  '--scrollbar-thumb',
  '--scrollbar-thumb-hover',
] as const;

const COLOR_VARIABLES: ReadonlySet<string> = new Set(THEME_COLOR_VARIABLES);

const NUMBER = String.raw`\s*-?(?:\d+\.?\d*|\.\d+)(?:%|deg)?\s*`;
// 逗号分隔（rgb(1, 2, 3)）与空格分隔（hsl(30 20% 90% / 0.5)）两种写法
const COMMA_ARGS = String.raw`(?:${NUMBER},){2}${NUMBER}(?:,${NUMBER})?`;
const SPACE_ARGS = String.raw`${NUMBER}\s${NUMBER}\s${NUMBER}(?:/${NUMBER})?`;
const COLOR_VALUE = new RegExp(
  String.raw`^(?:#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|(?:rgb|rgba|hsl|hsla)\((?:${COMMA_ARGS}|${SPACE_ARGS})\))$`
);

export function isThemeColorVariable(name: string): boolean {
  return COLOR_VARIABLES.has(name);
}

export function isColorValue(value: string): boolean {
  // 颜色字面量很短；先限长度再匹配，避免超长空白串引起正则回溯
  return value.length <= 64 && COLOR_VALUE.test(value.trim());
}

/** 外观设置中记录的主题键 */
export function pluginThemeKey(pluginId: PluginId, themeId: string): string {
  return `${pluginId}/${themeId}`;
}

/** 可选的插件主题（来自已启用插件的声明） */
export interface AvailablePluginTheme extends PluginTheme {
  key: string;
  pluginId: PluginId;
  pluginName: string;
}

/**
 * 在根元素上覆盖主题颜色（调用方先应用内置配色；切换或取消主题时内置配色重新应用即恢复）。
 * 不在允许范围内的变量或值一律忽略
 */
export function applyPluginThemeColors(colors: Readonly<Record<string, string>>, root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(colors)) {
    if (isThemeColorVariable(name) && isColorValue(value)) root.style.setProperty(name, value.trim());
  }
}

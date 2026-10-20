// ================================
// 插件快捷键
// - 写法：修饰键与按键以 + 连接，如 Ctrl+Alt+D、Cmd+Shift+K、Mod+Alt+1（Mod 在 macOS 为 ⌘，其他平台为 Ctrl）
// - 平台：mac / win / linux 字段覆盖通用的 key
// - 必须含 Ctrl / ⌘ / Alt 之一（F1～F12 除外），避免占用普通输入
// - 冲突：与应用快捷键相同的绑定不生效；多个插件绑定同一组合时按插件 ID 顺序先到先得，其余报告冲突
// 按 KeyboardEvent.code 匹配（macOS 上按住 ⌥ 时 key 会变成特殊字符）
// ================================

import type { PluginId, PluginKeybinding } from './types';

export type Platform = 'mac' | 'win' | 'linux';

export interface ParsedKeybinding {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  /** KeyboardEvent.code，如 KeyD、Digit1、F5、BracketLeft */
  code: string;
}

const MODIFIER_ALIASES: Record<string, 'ctrl' | 'meta' | 'alt' | 'shift' | 'mod'> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
  mod: 'mod',
};

const NAMED_KEYS: Record<string, { code: string; label: string }> = {
  '[': { code: 'BracketLeft', label: '[' },
  ']': { code: 'BracketRight', label: ']' },
  ';': { code: 'Semicolon', label: ';' },
  "'": { code: 'Quote', label: "'" },
  ',': { code: 'Comma', label: ',' },
  '.': { code: 'Period', label: '.' },
  '/': { code: 'Slash', label: '/' },
  '\\': { code: 'Backslash', label: '\\' },
  '`': { code: 'Backquote', label: '`' },
  '-': { code: 'Minus', label: '-' },
  '=': { code: 'Equal', label: '=' },
  space: { code: 'Space', label: 'Space' },
  enter: { code: 'Enter', label: 'Enter' },
  up: { code: 'ArrowUp', label: '↑' },
  down: { code: 'ArrowDown', label: '↓' },
  left: { code: 'ArrowLeft', label: '←' },
  right: { code: 'ArrowRight', label: '→' },
};

function keyCode(key: string): string | null {
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (/^f([1-9]|1[0-2])$/.test(key)) return key.toUpperCase();
  return NAMED_KEYS[key]?.code ?? null;
}

function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (/^F\d+$/.test(code)) return code;
  return Object.values(NAMED_KEYS).find((entry) => entry.code === code)?.label ?? code;
}

/**
 * 解析快捷键写法；不合法时返回 null
 */
export function parseKeybinding(text: string, platform: Platform): ParsedKeybinding | null {
  const parts = text.split('+').map((part) => part.trim().toLowerCase());
  const key = parts.pop();
  if (!key || parts.some((part) => !part)) return null;
  const parsed: ParsedKeybinding = { ctrl: false, meta: false, alt: false, shift: false, code: '' };
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part];
    if (!modifier) return null;
    const target = modifier === 'mod' ? (platform === 'mac' ? 'meta' : 'ctrl') : modifier;
    if (parsed[target]) return null;
    parsed[target] = true;
  }
  const code = keyCode(key);
  if (!code) return null;
  parsed.code = code;
  if (!parsed.ctrl && !parsed.meta && !parsed.alt && !/^F\d+$/.test(code)) return null;
  return parsed;
}

/** 当前平台对应的写法：平台字段优先于通用的 key */
export function keybindingText(binding: PluginKeybinding, platform: Platform): string {
  return binding[platform] ?? binding.key;
}

/** 用于比较是否冲突的规范形式 */
export function keybindingId(parsed: ParsedKeybinding): string {
  return [parsed.ctrl && 'ctrl', parsed.alt && 'alt', parsed.shift && 'shift', parsed.meta && 'meta', parsed.code]
    .filter(Boolean)
    .join('+');
}

/** 显示用文字：macOS 用 ⌃⌥⇧⌘ 符号，其他平台用 Ctrl+Alt+Shift */
export function formatKeybinding(parsed: ParsedKeybinding, platform: Platform): string {
  const key = keyLabel(parsed.code);
  if (platform === 'mac') {
    return `${parsed.ctrl ? '⌃' : ''}${parsed.alt ? '⌥' : ''}${parsed.shift ? '⇧' : ''}${parsed.meta ? '⌘' : ''}${key}`;
  }
  return [parsed.ctrl && 'Ctrl', parsed.meta && 'Win', parsed.alt && 'Alt', parsed.shift && 'Shift', key]
    .filter(Boolean)
    .join('+');
}

export function matchesKeyboardEvent(
  parsed: ParsedKeybinding,
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>
): boolean {
  return (
    event.code === parsed.code &&
    event.ctrlKey === parsed.ctrl &&
    event.metaKey === parsed.meta &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift
  );
}

export function currentPlatform(): Platform {
  const platform = typeof window !== 'undefined' ? window.electron?.platform : undefined;
  if (platform === 'darwin') return 'mac';
  if (platform === 'win32') return 'win';
  if (platform) return 'linux';
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? 'mac' : 'linux';
}

/** 应用与编辑器已占用的快捷键（插件不能覆盖） */
export const RESERVED_KEYBINDINGS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'Mod+N', label: '快速输入' },
  { key: 'Mod+P', label: '全局搜索' },
  { key: 'Mod+Shift+P', label: '命令面板' },
  { key: 'Mod+B', label: '切换侧边栏 / 粗体' },
  { key: 'Mod+1', label: '知识库模式' },
  { key: 'Mod+2', label: '写作模式' },
  { key: 'Mod+3', label: '阅读模式' },
  { key: 'Mod+Shift+F', label: '专注模式' },
  { key: 'Mod+,', label: '设置' },
  { key: 'Mod+S', label: '保存' },
  { key: 'Mod+Shift+R', label: '快速录音' },
  { key: 'Mod+W', label: '关闭标签' },
  { key: 'Mod+Shift+T', label: '重新打开关闭的标签' },
  { key: 'Mod+\\', label: '分栏' },
  { key: 'Mod+Z', label: '撤销' },
  { key: 'Mod+Shift+Z', label: '重做' },
  { key: 'Mod+Y', label: '重做' },
  { key: 'Mod+A', label: '全选' },
  { key: 'Mod+C', label: '复制' },
  { key: 'Mod+V', label: '粘贴' },
  { key: 'Mod+X', label: '剪切' },
  { key: 'Mod+F', label: '查找' },
  { key: 'Mod+I', label: '斜体' },
  { key: 'Mod+E', label: '行内代码' },
  { key: 'Mod+K', label: '插入链接' },
  { key: 'Mod+Shift+M', label: 'LaTeX 诊断面板' },
  { key: 'Mod+Alt+[', label: '折叠' },
  { key: 'Mod+Alt+]', label: '展开' },
];

export interface KeybindingEntry {
  pluginId: PluginId;
  pluginName: string;
  binding: PluginKeybinding;
  commandTitle: string;
}

export interface ResolvedKeybinding extends KeybindingEntry {
  parsed: ParsedKeybinding;
  /** 显示用文字 */
  label: string;
  /** 与之冲突而未生效的原因；为空表示生效 */
  conflict: string | null;
}

/**
 * 计算当前平台下各插件快捷键是否生效（entries 应按插件 ID 排序，靠前者优先）
 */
export function resolveKeybindings(entries: readonly KeybindingEntry[], platform: Platform): ResolvedKeybinding[] {
  const owners = new Map<string, string>();
  for (const reserved of RESERVED_KEYBINDINGS) {
    const parsed = parseKeybinding(reserved.key, platform);
    if (parsed) owners.set(keybindingId(parsed), `应用快捷键「${reserved.label}」`);
  }

  const result: ResolvedKeybinding[] = [];
  for (const entry of entries) {
    const parsed = parseKeybinding(keybindingText(entry.binding, platform), platform);
    if (!parsed) continue;
    const id = keybindingId(parsed);
    const owner = owners.get(id);
    if (!owner) owners.set(id, `插件「${entry.pluginName}」的命令「${entry.commandTitle}」`);
    result.push({
      ...entry,
      parsed,
      label: formatKeybinding(parsed, platform),
      conflict: owner ? `与${owner}冲突，未生效` : null,
    });
  }
  return result;
}

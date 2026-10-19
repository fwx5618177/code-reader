// ================================
// 插件快捷键：解析、平台差异、显示、事件匹配与冲突检测
// ================================

import { describe, it, expect } from 'vitest';
import {
  formatKeybinding,
  keybindingText,
  matchesKeyboardEvent,
  parseKeybinding,
  resolveKeybindings,
  type KeybindingEntry,
} from '../keybindings';

const event = (code: string, modifiers: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe('parseKeybinding', () => {
  it('解析修饰键别名与按键，Mod 随平台变化', () => {
    expect(parseKeybinding('Ctrl+Alt+D', 'win')).toEqual({ ctrl: true, meta: false, alt: true, shift: false, code: 'KeyD' });
    expect(parseKeybinding('Mod+Shift+1', 'mac')).toEqual({ ctrl: false, meta: true, alt: false, shift: true, code: 'Digit1' });
    expect(parseKeybinding('Mod+Shift+1', 'linux')).toMatchObject({ ctrl: true, meta: false });
    expect(parseKeybinding('option+command+[', 'mac')).toMatchObject({ alt: true, meta: true, code: 'BracketLeft' });
    expect(parseKeybinding('F5', 'win')?.code).toBe('F5');
  });

  it('拒绝缺少 Ctrl / Cmd / Alt、未知修饰键、重复修饰键与未知按键', () => {
    expect(parseKeybinding('Shift+K', 'win')).toBeNull();
    expect(parseKeybinding('K', 'win')).toBeNull();
    expect(parseKeybinding('Hyper+K', 'win')).toBeNull();
    expect(parseKeybinding('Ctrl+Ctrl+K', 'win')).toBeNull();
    expect(parseKeybinding('Ctrl+Escape', 'win')).toBeNull();
    expect(parseKeybinding('Ctrl+', 'win')).toBeNull();
  });
});

describe('快捷键显示与匹配', () => {
  it('平台字段优先于通用写法', () => {
    const binding = { command: 'run', key: 'Ctrl+Alt+R', mac: 'Cmd+Shift+R' };
    expect(keybindingText(binding, 'mac')).toBe('Cmd+Shift+R');
    expect(keybindingText(binding, 'win')).toBe('Ctrl+Alt+R');
  });

  it('macOS 用符号，其他平台用文字', () => {
    expect(formatKeybinding(parseKeybinding('Ctrl+Alt+Shift+Cmd+K', 'mac')!, 'mac')).toBe('⌃⌥⇧⌘K');
    expect(formatKeybinding(parseKeybinding('Ctrl+Shift+/', 'win')!, 'win')).toBe('Ctrl+Shift+/');
  });

  it('按 code 与修饰键精确匹配（多按一个修饰键不算匹配）', () => {
    const parsed = parseKeybinding('Ctrl+Alt+D', 'win')!;
    expect(matchesKeyboardEvent(parsed, event('KeyD', { ctrlKey: true, altKey: true }))).toBe(true);
    expect(matchesKeyboardEvent(parsed, event('KeyD', { ctrlKey: true, altKey: true, shiftKey: true }))).toBe(false);
    expect(matchesKeyboardEvent(parsed, event('KeyF', { ctrlKey: true, altKey: true }))).toBe(false);
  });
});

describe('resolveKeybindings', () => {
  const entry = (pluginId: string, key: string, command = 'run'): KeybindingEntry => ({
    pluginId,
    pluginName: `插件${pluginId}`,
    binding: { command, key },
    commandTitle: `命令${command}`,
  });

  it('与应用快捷键相同的绑定不生效', () => {
    const [resolved] = resolveKeybindings([entry('a', 'Mod+P')], 'mac');
    expect(resolved!.conflict).toBe('与应用快捷键「全局搜索」冲突，未生效');
    expect(resolved!.label).toBe('⌘P');
  });

  it('多个插件绑定同一组合时靠前者生效，其余报告冲突', () => {
    const [first, second, third] = resolveKeybindings(
      [entry('a', 'Ctrl+Alt+K'), entry('b', 'Alt+Ctrl+K', 'stats'), entry('c', 'Ctrl+Alt+J')],
      'win'
    );
    expect(first!.conflict).toBeNull();
    expect(second!.conflict).toBe('与插件「插件a」的命令「命令run」冲突，未生效');
    expect(third!.conflict).toBeNull();
  });

  it('Windows / Linux：Mod 解析为 Ctrl，按平台显示，按事件匹配 Ctrl 而不是 Meta', () => {
    for (const platform of ['win', 'linux'] as const) {
      const [reserved, own] = resolveKeybindings([entry('a', 'Mod+P'), entry('b', 'Mod+Alt+9')], platform);
      expect(reserved!.conflict).toBe('与应用快捷键「全局搜索」冲突，未生效');
      expect(reserved!.label).toBe('Ctrl+P');
      expect(own!.conflict).toBeNull();
      expect(own!.label).toBe('Ctrl+Alt+9');
      const press = (init: Partial<KeyboardEvent>) =>
        matchesKeyboardEvent(own!.parsed, { code: 'Digit9', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init });
      expect(press({ ctrlKey: true, altKey: true })).toBe(true);
      expect(press({ metaKey: true, altKey: true })).toBe(false);
    }
  });

  it('内置插件 writing-tools 的快捷键在三个平台上都生效且不与应用快捷键冲突', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../../assets/plugins/writing-tools/manifest.json'), 'utf-8')
    ) as { contributes: { keybindings: Array<{ command: string; key: string; mac?: string }> } };
    const entries = manifest.contributes.keybindings.map((binding) => ({
      pluginId: 'writing-tools',
      pluginName: '写作助手',
      binding,
      commandTitle: binding.command,
    }));
    const labels = (platform: 'mac' | 'win' | 'linux') =>
      resolveKeybindings(entries, platform).map((resolved) => [resolved.label, resolved.conflict]);
    expect(labels('mac')).toEqual([
      ['⇧⌘D', null],
      ['⌥⌘K', null],
    ]);
    expect(labels('win')).toEqual([
      ['Ctrl+Alt+D', null],
      ['Ctrl+Alt+K', null],
    ]);
    expect(labels('linux')).toEqual(labels('win'));
  });
});

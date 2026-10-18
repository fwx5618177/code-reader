// ================================
// 插件界面入口：快捷键分发（冲突与 editorFocus）、命令面板快捷键提示、侧栏插件视图、标签栏工具按钮
// 插件服务以可控的假实现替代
// ================================

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VIEW_ITEMS } from '../../../lib/plugins/extension-registry';
import { resolveKeybindings } from '../../../lib/plugins/keybindings';
import type { PluginContributions } from '../../../services/pluginService';

const fake = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  snapshot: null as unknown,
}));

vi.mock('../../../services/pluginService', async () => {
  const { createHostExtensionRegistry } = await import('../../../lib/plugins/extension-registry');
  return {
    pluginService: {
      registry: createHostExtensionRegistry(),
      init: vi.fn(async () => undefined),
      subscribe: (listener: () => void) => {
        fake.listeners.add(listener);
        return () => fake.listeners.delete(listener);
      },
      getSnapshot: () => fake.snapshot,
      getCommands: () => (fake.snapshot as { contributions: PluginContributions }).contributions.commands,
      runCommand: vi.fn(),
      notifyViewsShown: vi.fn(),
      resolvePermissionRequest: vi.fn(),
    },
  };
});

const { pluginService } = await import('../../../services/pluginService');
const { PluginHost } = await import('../index');
const { default: PluginViewsPanel } = await import('../PluginViews');
const { default: PluginToolbar } = await import('../PluginToolbar');

const EMPTY: PluginContributions = {
  commands: [],
  keybindings: [],
  slashItems: [],
  toolbar: [],
  views: [],
  themes: [],
  languages: [],
};

function setContributions(contributions: Partial<PluginContributions>) {
  fake.snapshot = {
    initialized: true,
    pluginsDir: '',
    plugins: [],
    permissionRequest: null,
    contributions: { ...EMPTY, ...contributions },
  };
  act(() => fake.listeners.forEach((listener) => listener()));
}

const keybinding = (pluginId: string, key: string, when?: 'editorFocus') =>
  resolveKeybindings(
    [{ pluginId, pluginName: pluginId, binding: { command: 'run', key, ...(when ? { when } : {}) }, commandTitle: '运行' }],
    'linux'
  );

describe('插件界面入口', () => {
  beforeEach(() => {
    vi.mocked(pluginService.runCommand).mockClear();
    vi.mocked(pluginService.notifyViewsShown).mockClear();
    pluginService.registry.unregisterAllByPlugin('demo');
    setContributions({});
  });

  it('按下插件快捷键执行命令；与应用快捷键冲突的绑定不生效', () => {
    render(<PluginHost>{null}</PluginHost>);
    setContributions({ keybindings: [...keybinding('demo', 'Ctrl+Alt+K'), ...keybinding('other', 'Ctrl+P')] });

    fireEvent.keyDown(window, { code: 'KeyK', ctrlKey: true, altKey: true });
    expect(pluginService.runCommand).toHaveBeenCalledWith('demo', 'run', undefined);

    fireEvent.keyDown(window, { code: 'KeyP', ctrlKey: true });
    expect(pluginService.runCommand).toHaveBeenCalledTimes(1);
  });

  it('when: editorFocus 的快捷键只在焦点位于编辑器内时生效', () => {
    render(
      <PluginHost>
        <div className="ProseMirror" contentEditable tabIndex={0} data-testid="editor" />
        <input data-testid="title" />
      </PluginHost>
    );
    setContributions({ keybindings: keybinding('demo', 'Ctrl+Alt+D', 'editorFocus') });

    screen.getByTestId('title').focus();
    fireEvent.keyDown(window, { code: 'KeyD', ctrlKey: true, altKey: true });
    expect(pluginService.runCommand).not.toHaveBeenCalled();

    screen.getByTestId('editor').focus();
    fireEvent.keyDown(window, { code: 'KeyD', ctrlKey: true, altKey: true });
    expect(pluginService.runCommand).toHaveBeenCalledWith('demo', 'run', undefined);
  });

  it('命令面板显示命令的快捷键', () => {
    // jsdom 没有 scrollIntoView（面板高亮项滚动到可见区域时调用）
    Element.prototype.scrollIntoView = vi.fn();
    render(<PluginHost>{null}</PluginHost>);
    setContributions({
      commands: [{ pluginId: 'demo', pluginName: '演示', commandId: 'run', title: '运行', keybinding: 'Ctrl+Alt+K' }],
    });
    fireEvent.keyDown(window, { code: 'KeyP', ctrlKey: true, shiftKey: true });
    const option = screen.getByRole('option', { name: /运行/ });
    expect(option.querySelector('kbd')?.textContent).toBe('Ctrl+Alt+K');
  });

  it('插件视图：显示视图名与插件提供的列表，点击带命令的项执行命令（带参数），显示时触发 onView', () => {
    setContributions({ views: [{ id: 'list', name: '写作统计', pluginId: 'demo', pluginName: '演示' }] });
    render(<PluginViewsPanel />);
    expect(screen.getByText('插件尚未提供内容')).toBeTruthy();
    expect(pluginService.notifyViewsShown).toHaveBeenCalledWith(['list']);

    act(() =>
      pluginService.registry.registerExtension(VIEW_ITEMS, 'demo', {
        list: [{ label: '120 字', description: '汉字 100', command: 'run', args: [1] }, { label: '只读项' }],
      })
    );
    fireEvent.click(screen.getByRole('button', { name: /120 字/ }));
    expect(pluginService.runCommand).toHaveBeenCalledWith('demo', 'run', [1]);
    expect(screen.queryByRole('button', { name: /只读项/ })).toBeNull();
    expect(screen.getByText('只读项')).toBeTruthy();
  });

  it('没有插件视图时提示启用插件', () => {
    render(<PluginViewsPanel />);
    expect(screen.getByText(/没有插件提供视图/)).toBeTruthy();
  });

  it('标签栏工具按钮：图标按钮带提示，点击执行命令', () => {
    setContributions({
      toolbar: [{ pluginId: 'demo', pluginName: '演示', commandId: 'run', title: '运行', icon: 'chart', tooltip: '统计字数' }],
    });
    render(<PluginToolbar buttonClassName="btn" />);
    const button = screen.getByRole('button', { name: '统计字数' });
    expect(button.getAttribute('title')).toBe('统计字数（演示）');
    fireEvent.click(button);
    expect(pluginService.runCommand).toHaveBeenCalledWith('demo', 'run');
  });
});

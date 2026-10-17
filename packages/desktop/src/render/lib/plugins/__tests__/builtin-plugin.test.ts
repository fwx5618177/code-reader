// ================================
// 内置示例插件（assets/plugins/writing-tools）测试：
// manifest 合法（含快捷键、斜杠菜单、标签栏按钮、视图、配置、激活事件），入口满足单文件要求，
// 命令、状态栏、侧栏视图与配置变更在假 app 上按预期工作
// ================================

import { describe, it, expect, vi } from 'vitest';
import manifestJson from '../../../../../assets/plugins/writing-tools/manifest.json';
import code from '../../../../../assets/plugins/writing-tools/main.js?raw';
import { validateManifest } from '../manifest';
import { assertSelfContained } from '../worker-plugin';

function createFakeApp(content: string, options: { inputValue?: string; language?: string } = {}) {
  const commands = new Map<string, () => Promise<unknown>>();
  const storage = new Map<string, unknown>();
  const config = new Map<string, unknown>([
    ['dateFormat', 'iso-weekday'],
    ['readingSpeed', 400],
    ['showStatusBar', true],
  ]);
  const configListeners: Array<(key: string) => void> = [];
  const editor = { content, insertText: vi.fn(async (_text: string) => undefined) };
  const statusBar = vi.fn(async (_item: { text: string; command?: string }) => undefined);
  const clearStatusBar = vi.fn(async () => undefined);
  const views = vi.fn(async (_id: string, _items: Array<{ label: string; command?: string }>) => undefined);
  const showMessage = vi.fn(async (_message: string) => undefined);
  const app = {
    commands: { register: async (id: string, handler: () => Promise<unknown>) => void commands.set(id, handler) },
    editor: {
      getContent: async () => editor.content,
      getLanguage: async () => options.language ?? 'markdown',
      getSelection: async () => '',
      insertText: editor.insertText,
      onDidChange: async () => undefined,
    },
    ui: { showMessage, showInput: async () => options.inputValue },
    statusBar: { set: statusBar, clear: clearStatusBar },
    views: { set: views },
    config: {
      get: async (key: string) => config.get(key),
      onDidChange: async (listener: (key: string) => void) => void configListeners.push(listener),
    },
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => void storage.set(key, value),
    },
  };
  /** 模拟用户在设置中修改配置 */
  const changeConfig = async (key: string, value: unknown) => {
    config.set(key, value);
    configListeners.forEach((listener) => listener(key));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { commands, app, editor, statusBar, clearStatusBar, views, showMessage, storage, changeConfig };
}

async function loadPlugin(): Promise<{ activate: (app: unknown) => Promise<void> }> {
  return import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(code)}`);
}

describe('内置插件 writing-tools', () => {
  it('manifest 合法且入口不含 import', () => {
    const { manifest, errors } = validateManifest(manifestJson, 'writing-tools');
    expect(errors).toEqual([]);
    expect(manifest?.contributes.commands.map((command) => command.id)).toEqual(['insert-date', 'word-stats', 'set-goal']);
    expect(manifest?.contributes.keybindings).toHaveLength(2);
    expect(manifest?.contributes.menus['editor/context'].map((item) => item.command)).toEqual(['insert-date', 'word-stats']);
    expect(manifest?.contributes.views).toEqual([{ id: 'stats', name: '写作统计' }]);
    expect(Object.keys(manifest?.contributes.configuration?.properties ?? {})).toEqual([
      'dateFormat',
      'readingSpeed',
      'showStatusBar',
    ]);
    expect(manifest?.activationEvents).toEqual(['onLanguage:markdown', 'onLanguage:latex', 'onView:stats']);
    expect(() => assertSelfContained(code)).not.toThrow();
  });

  it('注册命令：插入日期、统计字数、设置字数目标，并更新状态栏与侧栏视图', async () => {
    const plugin = await loadPlugin();
    const fake = createFakeApp('# 标题\n\n你好 world，这是 **测试**。', { inputValue: '10' });
    await plugin.activate(fake.app);

    expect([...fake.commands.keys()]).toEqual(['insert-date', 'word-stats', 'set-goal']);
    expect(fake.statusBar).toHaveBeenLastCalledWith(expect.objectContaining({ text: '9 字', command: 'set-goal' }));
    expect(fake.views).toHaveBeenLastCalledWith('stats', [
      expect.objectContaining({ label: '9 字', command: 'word-stats' }),
      { label: '预计阅读 1 分钟' },
      expect.objectContaining({ label: '设置字数目标…', command: 'set-goal' }),
    ]);

    await fake.commands.get('insert-date')!();
    expect(fake.editor.insertText).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2} 星期[日一二三四五六]$/));

    await fake.commands.get('word-stats')!();
    expect(fake.showMessage).toHaveBeenCalledWith(expect.stringContaining('共 9 字（汉字 8，英文单词 1）'));

    await fake.commands.get('set-goal')!();
    expect(fake.storage.get('goal')).toBe(10);
    expect(fake.statusBar).toHaveBeenLastCalledWith(expect.objectContaining({ text: '9 / 10 字（90%）' }));
    expect(fake.views.mock.calls.at(-1)![1][2]).toEqual(expect.objectContaining({ label: '目标 10 字（90%）' }));
  });

  it('按配置的日期格式插入日期；关闭状态栏显示后清除状态栏项', async () => {
    const plugin = await loadPlugin();
    const fake = createFakeApp('正文');
    await plugin.activate(fake.app);

    await fake.changeConfig('dateFormat', 'chinese');
    await fake.commands.get('insert-date')!();
    expect(fake.editor.insertText).toHaveBeenLastCalledWith(expect.stringMatching(/^\d{4}年\d{1,2}月\d{1,2}日$/));

    await fake.changeConfig('showStatusBar', false);
    expect(fake.clearStatusBar).toHaveBeenCalled();
  });

  it('LaTeX 文档按去掉命令后的正文计数', async () => {
    const plugin = await loadPlugin();
    const fake = createFakeApp('\\section{引言}\\label{sec:a}\n% 注释不计\n见 \\ref{sec:a} 与 $x$。', { language: 'latex' });
    await plugin.activate(fake.app);
    // 引言（2）+ 见、与（2）+ x（1）
    expect(fake.statusBar).toHaveBeenLastCalledWith(expect.objectContaining({ text: '5 字' }));
  });
});

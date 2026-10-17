// ================================
// 内置示例插件（assets/plugins/writing-tools）测试：
// manifest 合法、入口满足单文件要求，命令在假 app 上按预期工作
// ================================

import { describe, it, expect, vi } from 'vitest';
import manifestJson from '../../../../../assets/plugins/writing-tools/manifest.json';
import code from '../../../../../assets/plugins/writing-tools/main.js?raw';
import { validateManifest } from '../manifest';
import { assertSelfContained } from '../worker-plugin';

function createFakeApp(content: string, inputValue?: string) {
  const commands = new Map<string, () => Promise<unknown>>();
  const storage = new Map<string, unknown>();
  const editor = { content, insertText: vi.fn(async (_text: string) => undefined) };
  const statusBar = vi.fn(async (_item: { text: string; command?: string }) => undefined);
  const showMessage = vi.fn(async (_message: string) => undefined);
  const app = {
    commands: { register: async (id: string, handler: () => Promise<unknown>) => void commands.set(id, handler) },
    editor: {
      getContent: async () => editor.content,
      getSelection: async () => '',
      insertText: editor.insertText,
      onDidChange: async () => undefined,
    },
    ui: { showMessage, showInput: async () => inputValue },
    statusBar: { set: statusBar, clear: async () => undefined },
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => void storage.set(key, value),
    },
  };
  return { commands, app, editor, statusBar, showMessage, storage };
}

async function loadPlugin(): Promise<{ activate: (app: unknown) => Promise<void> }> {
  return import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(code)}`);
}

describe('内置插件 writing-tools', () => {
  it('manifest 合法且入口不含 import', () => {
    const { manifest, errors } = validateManifest(manifestJson, 'writing-tools');
    expect(errors).toEqual([]);
    expect(manifest?.contributes.commands.map((command) => command.id)).toEqual(['insert-date', 'word-stats', 'set-goal']);
    expect(() => assertSelfContained(code)).not.toThrow();
  });

  it('注册命令：插入日期、统计字数、设置字数目标并更新状态栏', async () => {
    const plugin = await loadPlugin();
    const fake = createFakeApp('# 标题\n\n你好 world，这是 **测试**。', '10');
    await plugin.activate(fake.app);

    expect([...fake.commands.keys()]).toEqual(['insert-date', 'word-stats', 'set-goal']);
    expect(fake.statusBar).toHaveBeenLastCalledWith(expect.objectContaining({ text: '9 字', command: 'set-goal' }));

    await fake.commands.get('insert-date')!();
    expect(fake.editor.insertText).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2} 星期[日一二三四五六]$/));

    await fake.commands.get('word-stats')!();
    expect(fake.showMessage).toHaveBeenCalledWith(expect.stringContaining('共 9 字（汉字 8，英文单词 1）'));

    await fake.commands.get('set-goal')!();
    expect(fake.storage.get('goal')).toBe(10);
    expect(fake.statusBar).toHaveBeenLastCalledWith(expect.objectContaining({ text: '9 / 10 字（90%）' }));
  });
});

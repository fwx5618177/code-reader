// ================================
// 斜杠命令：内置命令之后追加外部命令（插件命令），选择后删除触发文本再执行
// ================================

import { describe, it, expect, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { markdownSchema, SlashCommandProvider, type ExternalSlashCommand } from '../index';

function fakeView(text: string) {
  const doc = markdownSchema.node('doc', null, [markdownSchema.node('paragraph', null, [markdownSchema.text(text)])]);
  const view = {
    state: EditorState.create({ doc, selection: TextSelection.create(doc, 1 + text.length) }),
    dispatch(tr: Parameters<EditorView['dispatch']>[0]) {
      view.state = view.state.apply(tr);
    },
    focus: vi.fn(),
  };
  return view;
}

describe('SlashCommandProvider 外部命令', () => {
  it('每次打开菜单时读取外部命令，排在内置命令之后，可按说明匹配', () => {
    let external: ExternalSlashCommand[] = [];
    const provider = new SlashCommandProvider(markdownSchema, () => external);
    const builtinCount = provider.getCompletions().length;

    external = [{ id: 'plugin:a.run', label: '插入日期', detail: '插件 · 写作助手', keywords: 'date rq', run: vi.fn() }];
    const items = provider.getCompletions();
    expect(items).toHaveLength(builtinCount + 1);
    expect(items.at(-1)).toMatchObject({ id: 'plugin:a.run', label: '插入日期', detail: '插件 · 写作助手' });
    expect(items.at(-1)!.filterText).toBe('插入日期 date rq');
    expect(items.at(-1)!.priority).toBeLessThan(items[0]!.priority!);
  });

  it('选择后删除斜杠触发文本再执行命令', () => {
    const run = vi.fn();
    const provider = new SlashCommandProvider(markdownSchema, () => [{ id: 'x', label: '插件命令', detail: '', run }]);
    const view = fakeView('你好/rq');
    const item = provider.getCompletions().find((completion) => completion.id === 'x')!;

    item.apply!(view as unknown as EditorView, 3, 6);
    expect(view.state.doc.textContent).toBe('你好');
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('文档属性（YAML 头部）命令', () => {
  it('在文档开头插入头部并把光标放进去；已有头部时只移动光标', () => {
    const provider = new SlashCommandProvider(markdownSchema);
    const command = provider.getCompletions().find((completion) => completion.id === 'front-matter')!;
    const view = fakeView('正文/sx');
    command.apply!(view as unknown as EditorView, 3, 6);
    expect(view.state.doc.firstChild!.type.name).toBe('front_matter');
    expect(view.state.selection.$from.parent.type.name).toBe('front_matter');
    expect(view.state.doc.child(1).textContent).toBe('正文');

    view.dispatch(view.state.tr.insertText('a: 1'));
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)).insertText('/sx'));
    const end = view.state.selection.from;
    command.apply!(view as unknown as EditorView, end - 3, end);
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.selection.$from.parent.type.name).toBe('front_matter');
    expect(view.state.selection.from).toBe(1 + 'a: 1'.length);
  });
});

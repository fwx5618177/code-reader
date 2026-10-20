// @vitest-environment jsdom
// ================================
// ProseMirror 补全适配器与 CodeMirror 补全预设
// ================================

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from 'prosemirror-schema-basic';
import { createAutocompleteService, type CompletionItem } from '@code-reader/autocomplete-service';
import {
  createCodeAutocompleteExtension,
  createDefaultAutocompleteService,
  createMarkdownAutocompleteExtension,
  createProseMirrorAdapter,
  snippetPlainText,
} from '../src';

// jsdom 没有布局：给 Range 补上面板定位（coordsAtPos）用到的几何接口
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

function editor(text: string, items: CompletionItem[]) {
  const service = createAutocompleteService({ maxResults: 10 });
  service.addItems(items);
  const adapter = createProseMirrorAdapter({ service });
  const doc = schema.node('doc', null, [schema.node('paragraph', null, text ? [schema.text(text)] : [])]);
  const state = EditorState.create({ doc, plugins: [adapter.createPlugin()] });
  const view = new EditorView(document.body.appendChild(document.createElement('div')), { state });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, text.length + 1)));
  return { adapter, view };
}

describe('ProseMirrorAdapter', () => {
  it('触发补全、上下选择、接受后替换查询词并关闭面板', async () => {
    const { adapter, view } = editor('写 alg', [
      { id: 'a', label: 'algorithm', type: 'text' },
      { id: 'b', label: 'algebra', type: 'text' },
    ]);
    const events: string[] = [];
    adapter.addEventListener((event) => events.push(event.type));

    await adapter.triggerCompletion(view);
    const state = adapter.getPluginKey().getState(view.state)!;
    expect(state.active).toBe(true);
    expect(state.items.map((item) => item.label).sort()).toEqual(['algebra', 'algorithm']);
    expect(document.querySelector('.autocomplete-panel')).not.toBeNull();

    adapter.selectNext(view);
    adapter.selectPrevious(view);
    adapter.selectPrevious(view);
    const chosen = adapter.getPluginKey().getState(view.state)!.items[1]!.label;
    adapter.acceptCompletion(view);

    expect(view.state.doc.textContent).toBe(`写 ${chosen}`);
    expect(adapter.getPluginKey().getState(view.state)!.active).toBe(false);
    expect(events).toEqual(['show', 'accept']);
    adapter.destroy();
    view.destroy();
  });

  it('片段去掉占位符后插入；没有结果时不打开面板', async () => {
    const { adapter, view } = editor('fn', [
      { id: 's', label: 'fn', type: 'snippet', insertText: 'function ${1:name}($2) {}$0' },
    ]);
    await adapter.triggerCompletion(view);
    adapter.acceptCompletion(view);
    expect(view.state.doc.textContent).toBe('function name() {}');

    const empty = editor('zzz', []);
    await empty.adapter.triggerCompletion(empty.view);
    expect(empty.adapter.getPluginKey().getState(empty.view.state)!.active).toBe(false);
    adapter.destroy();
    view.destroy();
    empty.adapter.destroy();
    empty.view.destroy();
  });

  it('snippetPlainText 保留默认值与第一个选项', () => {
    expect(snippetPlainText('${1:a} = ${2|let,const|} \\$x$0')).toBe('a = let $x');
  });
});

describe('补全预设', () => {
  it('默认服务注册 Markdown、Emoji、代码片段三个提供者', async () => {
    const service = await createDefaultAutocompleteService();
    expect(service.getProviders().map((provider) => provider.name).sort()).toEqual(['emoji', 'markdown', 'snippets']);
    expect(service.isReady()).toBe(true);
  });

  it('Markdown 与代码编辑器预设返回可用的 CodeMirror 扩展', async () => {
    expect((await createMarkdownAutocompleteExtension()).length).toBeGreaterThan(0);
    expect((await createCodeAutocompleteExtension('python')).length).toBeGreaterThan(0);
  });
});

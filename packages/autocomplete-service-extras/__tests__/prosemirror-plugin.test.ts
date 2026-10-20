// @vitest-environment jsdom
// ================================
// ProseMirror 补全插件：触发、过滤排序、键盘、结构化插入、刷新期间的旧结果、服务提供者桥接
// ================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from 'prosemirror-schema-basic';
import type { Node } from 'prosemirror-model';
import { EmojiProvider } from '@code-reader/autocomplete-service';
import {
  EditorAutocomplete,
  filterAndSortItems,
  findTriggerPosition,
  fromServiceProvider,
  type EditorCompletionContext,
  type EditorCompletionItem,
  type EditorCompletionProvider,
} from '../src';

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const item = (id: string, extra: Partial<EditorCompletionItem> = {}): EditorCompletionItem => ({
  id,
  label: id,
  insertText: id,
  type: 'text',
  ...extra,
});

function provider(
  trigger: string,
  items: EditorCompletionItem[],
  extra: Partial<EditorCompletionProvider> = {}
): EditorCompletionProvider & { contexts: EditorCompletionContext[] } {
  const contexts: EditorCompletionContext[] = [];
  return {
    name: trigger,
    triggerCharacters: [trigger],
    shouldActivate: (context) => context.trigger === trigger,
    getCompletions: (context) => {
      contexts.push(context);
      return items;
    },
    contexts,
    ...extra,
  };
}

function mount(doc: Node, autocomplete: EditorAutocomplete) {
  const host = document.body.appendChild(document.createElement('div'));
  const view = new EditorView(host.appendChild(document.createElement('div')), {
    state: EditorState.create({ doc, plugins: [autocomplete.createPlugin()] }),
  });
  return view;
}

const paragraph = (...content: Array<string | Node>) =>
  schema.node('doc', null, [
    schema.node(
      'paragraph',
      null,
      content.filter((part) => part !== '').map((part) => (typeof part === 'string' ? schema.text(part) : part))
    ),
  ]);

/** 在段落末尾输入文本，触发防抖刷新 */
function type(view: EditorView, text: string) {
  const end = view.state.doc.content.size - 1;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)).insertText(text));
}

function key(view: EditorView, name: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: name, ...init });
  return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false;
}

describe('findTriggerPosition / filterAndSortItems', () => {
  it('单字符触发符须在行首或空白后，多字符触发符任意位置，取最近的', () => {
    expect(findTriggerPosition('a/b', ['/'])).toBeNull();
    expect(findTriggerPosition('x /cmd', ['/'])).toEqual({ trigger: '/', from: 2 });
    expect(findTriggerPosition('见[[页', ['[[', '/'])).toEqual({ trigger: '[[', from: 1 });
  });

  it('按优先级、filterText 前缀、字母序排序；提供者已匹配的项不再过滤', () => {
    const own = item('zzz');
    const sorted = filterAndSortItems(
      [item('balpha', { filterText: 'xalpha' }), item('beta', { filterText: 'alpha2' }), item('top', { priority: 5, filterText: 'talpha' }), own],
      'alp',
      10,
      new Set([own])
    );
    expect(sorted.map((entry) => entry.id)).toEqual(['top', 'beta', 'balpha', 'zzz']);
  });
});

describe('EditorAutocomplete', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('输入触发符后防抖打开，键盘选择、回车插入并关闭', async () => {
    const slash = provider('/', [item('table'), item('tag')]);
    const autocomplete = new EditorAutocomplete({ providers: [slash], minTriggerLength: 0 });
    const view = mount(paragraph('写 '), autocomplete);

    type(view, '/ta');
    expect(autocomplete.getState(view.state).active).toBe(false);
    await vi.advanceTimersByTimeAsync(150);

    const state = autocomplete.getState(view.state);
    expect(state.active).toBe(true);
    expect(slash.contexts[0]).toMatchObject({ trigger: '/', query: 'ta', from: 2, to: 5 });
    expect(document.querySelectorAll('.pm-autocomplete-panel .pm-autocomplete-item')).toHaveLength(2);

    expect(key(view, 'ArrowDown')).toBe(true);
    expect(document.querySelector('.pm-autocomplete-item-active')?.textContent).toContain('tag');
    expect(key(view, 'Enter')).toBe(true);
    expect(view.state.doc.textContent).toBe('写 tag');
    expect(autocomplete.getState(view.state).active).toBe(false);
    expect(document.querySelector('.pm-autocomplete-panel')).toBeNull();
    view.destroy();
  });

  it('刷新前保留旧结果但回车交还编辑器；Esc 关闭并回调 onClose', async () => {
    const onClose = vi.fn();
    const autocomplete = new EditorAutocomplete({ providers: [provider('/', [item('table')])], minTriggerLength: 0, onClose });
    const view = mount(paragraph(''), autocomplete);
    type(view, '/t');
    await vi.advanceTimersByTimeAsync(150);
    type(view, 'a');

    expect(autocomplete.getState(view.state)).toMatchObject({ active: true, stale: true });
    expect(document.querySelector('.pm-autocomplete-panel')).not.toBeNull();
    expect(key(view, 'Enter')).toBe(false);
    expect(key(view, 'Escape')).toBe(true);
    expect(autocomplete.getState(view.state).active).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Esc 同时取消排队的刷新
    await vi.advanceTimersByTimeAsync(150);
    expect(autocomplete.getState(view.state).active).toBe(false);
    view.destroy();
  });

  it('结构化插入拿到含触发符的文档区间；按提供者上限截断', async () => {
    const apply = vi.fn((view: EditorView, from: number, to: number) => view.dispatch(view.state.tr.insertText('[[页]]', from, to)));
    const many = Array.from({ length: 30 }, (_, index) => item(`页${String(index).padStart(2, '0')}`, { apply }));
    const autocomplete = new EditorAutocomplete({
      providers: [provider('[[', many, { maxResults: 20 })],
      minTriggerLength: 0,
    });
    const view = mount(paragraph('见'), autocomplete);
    type(view, '[[页');
    await vi.advanceTimersByTimeAsync(150);

    expect(autocomplete.getState(view.state).items).toHaveLength(20);
    expect(autocomplete.acceptCompletion(view)).toBe(true);
    expect(apply).toHaveBeenCalledWith(view, 2, 5);
    expect(view.state.doc.textContent).toBe('见[[页]]');
    view.destroy();
  });

  it('行内原子节点占一个位置：替换区间仍与文档位置对齐', async () => {
    const autocomplete = new EditorAutocomplete({ providers: [provider(':', [item('smile', { insertText: '😊' })])] });
    const image = schema.nodes.image.create({ src: 'a.png' });
    const view = mount(paragraph('a', image, 'b '), autocomplete);
    type(view, ':sm');
    await vi.advanceTimersByTimeAsync(150);
    autocomplete.acceptCompletion(view);

    const children: string[] = [];
    view.state.doc.firstChild!.forEach((child) => children.push(child.isText ? child.text! : child.type.name));
    expect(children).toEqual(['a', 'image', 'b 😊']);
    view.destroy();
  });

  it('单词模式：没有触发符时用光标前的单词查询；Ctrl+空格忽略最小长度', async () => {
    const words = provider('', [item('algebra'), item('algorithm')], {
      triggerCharacters: [],
      shouldActivate: (context) => context.trigger === '',
    });
    const autocomplete = new EditorAutocomplete({ providers: [words], wordPattern: /\w+$/, minTriggerLength: 3 });
    const view = mount(paragraph('x '), autocomplete);
    type(view, 'al');
    await vi.advanceTimersByTimeAsync(150);
    expect(autocomplete.getState(view.state).active).toBe(false);

    expect(key(view, ' ', { ctrlKey: true })).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(autocomplete.getState(view.state).items.map((entry) => entry.label)).toEqual(['algebra', 'algorithm']);
    view.destroy();
  });

  it('点击补全项插入', async () => {
    const autocomplete = new EditorAutocomplete({ providers: [provider('/', [item('table')])], minTriggerLength: 0 });
    const view = mount(paragraph(''), autocomplete);
    type(view, '/');
    await vi.advanceTimersByTimeAsync(150);
    (document.querySelector('.pm-autocomplete-item') as HTMLElement).click();
    expect(view.state.doc.textContent).toBe('table');
    view.destroy();
  });
});

describe('fromServiceProvider（Emoji）', () => {
  const emoji = fromServiceProvider(new EmojiProvider(), { trigger: ':' });
  const context = (textBefore: string): EditorCompletionContext => {
    const from = textBefore.lastIndexOf(':');
    return { trigger: ':', query: textBefore.slice(from + 1), pos: textBefore.length, from, to: textBefore.length, textBefore, lineText: textBefore };
  };

  it('按短代码匹配，精确匹配排在最前；别名与中文描述也能匹配', async () => {
    expect((await emoji.getCompletions(context('好 :smile')))[0]).toMatchObject({ insertText: '😊', type: 'emoji', label: '😊 :smile:' });
    expect((await emoji.getCompletions(context(':+1'))).map((entry) => entry.insertText)).toContain('👍');
    expect((await emoji.getCompletions(context(':微笑'))).map((entry) => entry.insertText)).toContain('😊');
  });

  it('触发符后没有内容或含空白时不激活，结果不再按文本过滤', () => {
    expect(emoji.shouldActivate(context(':'))).toBe(false);
    expect(emoji.shouldActivate(context(':sm ile'))).toBe(false);
    expect(emoji.shouldActivate(context(':sm'))).toBe(true);
    expect(emoji.filtersOwnResults).toBe(true);
  });
});

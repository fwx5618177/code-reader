// @vitest-environment jsdom
// ================================
// 补全服务、内置提供者与 CodeMirror 适配器的行为测试
// ================================

import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  CompletionContext as CMCompletionContext,
  completionStatus,
  currentCompletions,
  startCompletion,
  type Completion,
} from '@codemirror/autocomplete';
import {
  AutocompleteService,
  CodeMirrorAdapter,
  EmojiProvider,
  MarkdownProvider,
  SnippetProvider,
  createAutocompleteService,
  createCodeProviders,
  toCodeMirrorSnippet,
  type CompletionContext,
  type CompletionItem,
  type CompletionProvider,
} from '../src';

function context(textBefore: string, extra: Partial<CompletionContext> = {}): CompletionContext {
  const query = /[\w.+-]*$/.exec(textBefore)?.[0] ?? '';
  return {
    query,
    position: { line: 1, column: textBefore.length + 1 },
    lineText: textBefore,
    textBefore,
    textAfter: '',
    ...extra,
  };
}

function codeService(): AutocompleteService {
  const service = createAutocompleteService({ maxResults: 50 });
  for (const provider of createCodeProviders()) service.registerProvider(provider);
  return service;
}

describe('AutocompleteService', () => {
  it('提供者按查询上下文实时取结果：片段按语言过滤，同一查询在不同语言下不共用缓存', async () => {
    const service = codeService();
    await service.initialize();

    const python = await service.getCompletions(context('def', { language: 'python' }));
    const js = await service.getCompletions(context('def', { language: 'javascript' }));
    const pythonIds = python.items.map((item) => item.id);

    expect(pythonIds).toContain('snippet-def-python');
    expect(pythonIds.some((id) => id.endsWith('-javascript'))).toBe(false);
    expect(js.items.map((item) => item.id)).not.toContain('snippet-def-python');
  });

  it('代码提供者集合不含 Markdown 与 Emoji：代码里的 # 与 : 不出现标题或表情', async () => {
    const service = codeService();
    const hash = await service.getCompletions(context('#', { query: '#', triggerCharacter: '#', language: 'python' }));
    const colon = await service.getCompletions(context('a:smile', { language: 'python' }));
    expect(hash.items.filter((item) => item.type === 'heading' || item.label.includes('标题'))).toEqual([]);
    expect(colon.items.filter((item) => item.type === 'emoji')).toEqual([]);
  });

  it('addItem 的静态补全项支持前缀与模糊检索，刷新提供者时保留', async () => {
    const service = createAutocompleteService({ fuzzy: true, maxEditDistance: 1 });
    service.addItems([
      { id: 'w1', label: 'algorithm', type: 'text' },
      { id: 'w2', label: 'alignment', type: 'text' },
    ]);

    expect((await service.getCompletions(context('alg'))).items.map((item) => item.id)).toEqual(['w1']);
    await service.refreshAllProviders();
    expect((await service.getCompletions(context('algorithn'))).items.map((item) => item.id)).toContain('w1');

    service.removeItem('algorithm');
    expect((await service.getCompletions(context('alg'))).items).toEqual([]);
  });

  it('加入补全项后立即可查到（缓存同步失效）', async () => {
    const service = createAutocompleteService();
    expect((await service.getCompletions(context('zeta'))).items).toEqual([]);
    service.addItem({ id: 'z', label: 'zeta', type: 'text' });
    expect((await service.getCompletions(context('zeta'))).items.map((item) => item.id)).toEqual(['z']);
  });

  it('不足最小触发长度时不查询；超过上限时截断并标记 isIncomplete', async () => {
    const service = createAutocompleteService({ maxResults: 2, minTriggerLength: 2 });
    service.addItems(['aa1', 'aa2', 'aa3'].map((label) => ({ id: label, label, type: 'text' as const })));
    expect((await service.getCompletions(context('a'))).items).toEqual([]);
    const result = await service.getCompletions(context('aa'));
    expect(result.items).toHaveLength(2);
    expect(result.isIncomplete).toBe(true);
  });

  it('提供者数据变化后 refreshProvider 丢弃其缓存结果', async () => {
    let label = 'first';
    const provider: CompletionProvider = {
      name: 'dynamic',
      type: 'custom',
      priority: 50,
      getCompletions: (): CompletionItem[] => [{ id: label, label, type: 'custom', source: 'dynamic' }],
    };
    const service = createAutocompleteService();
    service.registerProvider(provider);

    expect((await service.getCompletions(context('x'))).items[0]?.id).toBe('first');
    label = 'second';
    expect((await service.getCompletions(context('x'))).items[0]?.id).toBe('first');
    await service.refreshProvider('dynamic');
    expect((await service.getCompletions(context('x'))).items[0]?.id).toBe('second');
  });
});

describe('内置提供者', () => {
  it('EmojiProvider：短代码、别名、中文描述都能匹配，精确匹配优先', () => {
    const emoji = new EmojiProvider();
    expect(emoji.getCompletions(context(':smile'))[0]?.insertText).toBe('😊');
    expect(emoji.getCompletions(context(':+1')).map((item) => item.insertText)).toContain('👍');
    expect(emoji.getCompletions(context('', { query: '微笑', textBefore: ':微笑' })).map((item) => item.insertText)).toContain('😊');
  });

  it('MarkdownProvider：围栏代码块与行内代码中不提供补全', () => {
    const markdown = new MarkdownProvider();
    expect(markdown.getCompletions(context('#', { query: '#' })).length).toBeGreaterThan(0);
    expect(markdown.getCompletions(context('```js\n#', { query: '#', lineText: '#' }))).toEqual([]);
    expect(markdown.getCompletions(context('`#', { query: '#' }))).toEqual([]);
  });

  it('SnippetProvider：语言别名（ts、py）按所属语言匹配', () => {
    const snippets = new SnippetProvider();
    expect(snippets.getCompletions(context('interface', { language: 'ts' })).map((item) => item.id)).toContain(
      'snippet-interface-typescript'
    );
    expect(snippets.getCompletions(context('def', { language: 'py' })).map((item) => item.id)).toContain('snippet-def-python');
  });
});

describe('toCodeMirrorSnippet', () => {
  it('把 $N、${N:默认值}、${N|选项|}、$0 转成 CodeMirror 字段，并转义字面的花括号', () => {
    expect(toCodeMirrorSnippet('function $1($2) {\n\t$0\n}')).toBe('function ${1}(${2}) \\{\n\t${9999}\n\\}');
    expect(toCodeMirrorSnippet('${1:name} = ${2|let,const|}')).toBe('${1:name} = ${2:let}');
    expect(toCodeMirrorSnippet('price: \\$5 `${x}`')).toBe('price: $5 `$\\{x\\}`');
  });
});

describe('CodeMirrorAdapter', () => {
  it('片段补全按 snippet 插入：占位符变成字段，不留下 $1', async () => {
    const service = codeService();
    const adapter = new CodeMirrorAdapter({ service, language: 'javascript' });
    const source = adapter.createCompletionSource();
    const view = new EditorView({ state: EditorState.create({ doc: 'fn', selection: { anchor: 2 } }) });

    const result = await source(new CMCompletionContext(view.state, 2, true));
    const option = result!.options.find((item: Completion) => item.displayLabel === '函数声明')!;
    expect(option.label).toBe('fn');
    expect(typeof option.apply).toBe('function');
    (option.apply as (view: EditorView, completion: Completion, from: number, to: number) => void)(
      view,
      option,
      result!.from,
      2
    );

    expect(view.state.doc.toString()).toBe('function () {\n  \n}');
    view.destroy();
  });

  it('切换语言后按新语言给出片段', async () => {
    const adapter = new CodeMirrorAdapter({ service: codeService(), language: 'javascript' });
    adapter.setLanguage('python');
    const state = EditorState.create({ doc: 'def', selection: { anchor: 3 } });
    const result = await adapter.createCompletionSource()(new CMCompletionContext(state, 3, true));
    expect(result!.options.map((item) => item.displayLabel)).toContain('函数定义');
  });

  it('经扩展触发后补全列表真正打开：选项按触发词匹配，显示名称为中文（回归：曾因 label 为中文被全部过滤）', async () => {
    const adapter = new CodeMirrorAdapter({ service: codeService(), language: 'python' });
    const view = new EditorView({
      state: EditorState.create({ doc: 'x = 1\ndef', selection: { anchor: 9 }, extensions: adapter.createFullExtension() }),
      parent: document.body,
    });
    view.focus();
    startCompletion(view);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'));
    const options = currentCompletions(view.state);
    expect(options.map((option) => option.label)).toContain('def');
    expect(options.every((option) => !/javascript/i.test(option.detail ?? ''))).toBe(true);
    view.destroy();
  });
});

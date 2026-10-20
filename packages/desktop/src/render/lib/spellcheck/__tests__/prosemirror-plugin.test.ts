// ================================
// 拼写检查插件测试：在真实 EditorView 中用假检查器验证
// 错误单词标记、跳过代码块/行内代码、编辑后只重查改动的文本块、停用时清除标记
// ================================

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { markdownSchema, parseMarkdown } from '../../markdown';
import { createSpellcheckPlugin, spellcheckKey } from '../prosemirror-plugin';
import type { SpellChecker } from '../types';

const MISSPELLED = new Set(['speling', 'mistake', 'eror']);
const MENU_CLASSES = {
  menu: 'menu',
  item: 'item',
  itemActive: 'active',
  itemCurrent: 'current',
  heading: 'heading',
  separator: 'separator',
  hint: 'hint',
};

function createChecker() {
  const cache = new Map<string, boolean>();
  const listeners = new Set<() => void>();
  let active = true;
  const checker: SpellChecker & { setActive(value: boolean): void } = {
    activate: vi.fn(),
    isActive: () => active,
    lookup: vi.fn((word: string) => cache.get(word)),
    checkWords: vi.fn(async (words: string[]) => {
      for (const word of words) cache.set(word, !MISSPELLED.has(word));
    }),
    suggest: vi.fn(async () => []),
    addToDictionary: vi.fn(async () => {}),
    ignore: vi.fn(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setActive(value) {
      active = value;
      for (const listener of listeners) listener();
    },
  };
  return checker;
}

let view: EditorView | null = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  view?.destroy();
  view = null;
  vi.useRealTimers();
});

function createView(markdown: string, checker: SpellChecker): EditorView {
  const state = EditorState.create({
    doc: parseMarkdown(markdown),
    schema: markdownSchema,
    plugins: [createSpellcheckPlugin({ checker, errorClass: 'spell-error', menuClasses: MENU_CLASSES })],
  });
  const editor = new EditorView(document.createElement('div'), { state });
  // jsdom 没有布局：让编辑器“可见”，posAtCoords 返回 null 时按全文处理
  editor.dom.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400);
  vi.spyOn(editor, 'posAtCoords').mockReturnValue(null);
  view = editor;
  return editor;
}

/** 推进防抖计时器并等待异步检查完成 */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(200);
  await vi.runAllTimersAsync();
}

function markedWords(editor: EditorView): string[] {
  return spellcheckKey
    .getState(editor.state)!
    .decorations.find()
    .map((d) => editor.state.doc.textBetween(d.from, d.to))
    .sort();
}

describe('拼写检查插件', () => {
  it('标出错误单词，跳过代码块与行内代码', async () => {
    const checker = createChecker();
    const editor = createView('A speling eror here `speling`\n\n```\nspeling\n```\n\n- list mistake', checker);
    await settle();
    expect(markedWords(editor)).toEqual(['eror', 'mistake', 'speling']);
    expect(checker.activate).toHaveBeenCalled();
  });

  it('编辑后只重新检查改动的文本块', async () => {
    const checker = createChecker();
    const editor = createView('first speling\n\nsecond block', checker);
    await settle();
    expect(markedWords(editor)).toEqual(['speling']);

    const lookup = vi.mocked(checker.lookup);
    lookup.mockClear();
    const secondEnd = editor.state.doc.content.size - 1;
    editor.dispatch(editor.state.tr.insertText(' eror', secondEnd));
    await settle();

    expect(markedWords(editor)).toEqual(['eror', 'speling']);
    // 第一段未改动，不再重新检查；只有新词需要查询 Worker
    const looked = new Set(lookup.mock.calls.map(([word]) => word));
    expect(looked.has('first')).toBe(false);
    expect(looked.has('second')).toBe(true);
    const checked = vi.mocked(checker.checkWords).mock.calls;
    expect(checked[checked.length - 1][0]).toEqual(['eror']);
  });

  it('改正单词后标记消失', async () => {
    const checker = createChecker();
    const editor = createView('a speling test', checker);
    await settle();
    const [decoration] = spellcheckKey.getState(editor.state)!.decorations.find();
    editor.dispatch(editor.state.tr.insertText('spelling', decoration.from, decoration.to));
    expect(markedWords(editor)).toEqual([]);
    await settle();
    expect(markedWords(editor)).toEqual([]);
  });

  it('停用时清除标记，重新启用后恢复', async () => {
    const checker = createChecker();
    const editor = createView('a speling test', checker);
    await settle();
    checker.setActive(false);
    expect(markedWords(editor)).toEqual([]);
    checker.setActive(true);
    await settle();
    expect(markedWords(editor)).toEqual(['speling']);
  });
});

// ================================
// 含大量脚注的大文档：解析、逐键输入（全部 Markdown 插件）与保存的耗时
// 方法：performance.now() 计时取中位数；输入在文档中部的不同段落里进行
// ================================

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Plugin } from 'prosemirror-state';
import { createEditorPlugins } from '../../editor';
import {
  createAbbreviationPlugin,
  createBlockIdPlugin,
  createFootnoteNumberPlugin,
  createFrontMatterPlugin,
  createLivePreviewPlugin,
  markdownSchema,
  parseMarkdown,
  serializeMarkdown,
} from '../index';
import { perfBudget } from '@code-reader/test-support';

const PARAGRAPHS = 2000;

function buildDocument(): string {
  const body: string[] = ['---\ntags: [a, b]\n---'];
  for (let i = 0; i < PARAGRAPHS; i++) {
    body.push(`第 ${i} 段，带一个脚注[^n${i}]，以及 **粗体** 与 $x_${i}$ 公式。`);
  }
  for (let i = 0; i < PARAGRAPHS; i++) body.push(`[^n${i}]: 脚注 ${i} 的内容。`);
  return body.join('\n\n') + '\n';
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function time(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

describe('大量脚注的大文档性能', () => {
  it('逐键输入与保存不随脚注数量线性变慢', () => {
    const markdown = buildDocument();
    let doc = parseMarkdown(markdown);
    const parseTimes = [0, 1, 2].map(() => time(() => (doc = parseMarkdown(markdown))));

    const plugins: Plugin[] = [
      ...createEditorPlugins(markdownSchema),
      createLivePreviewPlugin(markdownSchema),
      createAbbreviationPlugin(),
      createFootnoteNumberPlugin(),
      createFrontMatterPlugin(),
      createBlockIdPlugin('marker'),
    ];
    let state = EditorState.create({ doc, plugins });
    serializeMarkdown(state.doc);

    const keyTimes: number[] = [];
    const saveTimes: number[] = [];
    for (let i = 0; i < 200; i++) {
      // 在中部第 i 个段落的末尾输入一个字
      const paragraph = state.doc.child(PARAGRAPHS / 2 + (i % 50));
      let pos = 0;
      state.doc.forEach((child, offset) => {
        if (child === paragraph) pos = offset + child.nodeSize - 1;
      });
      const tr = state.tr.setSelection(TextSelection.create(state.doc, pos)).insertText('字');
      keyTimes.push(time(() => (state = state.apply(tr))));
      if (i % 10 === 0) saveTimes.push(time(() => serializeMarkdown(state.doc)));
    }

    // 最坏情况：插入新的脚注引用，全文重新编号
    const renumberTimes: number[] = [];
    for (let i = 0; i < 20; i++) {
      const index = PARAGRAPHS / 4 + i;
      let at = 0;
      state.doc.forEach((child, offset, childIndex) => {
        if (childIndex === index) at = offset + child.nodeSize - 1;
      });
      const tr = state.tr.insert(at, markdownSchema.nodes.footnote_ref.create({ label: `new${i}` }));
      renumberTimes.push(time(() => (state = state.apply(tr))));
    }

    const report = {
      parse: median(parseTimes).toFixed(1),
      keystroke: median(keyTimes).toFixed(3),
      keystrokeP95: [...keyTimes].sort((a, b) => a - b)[Math.floor(keyTimes.length * 0.95)]!.toFixed(3),
      save: median(saveTimes).toFixed(2),
      renumber: median(renumberTimes).toFixed(2),
    };
    console.log(`[perf] ${PARAGRAPHS} 段 + ${PARAGRAPHS} 个脚注（ms）`, report);

    // 一帧 16ms：逐键处理留给布局与绘制的时间要足够
    expect(median(keyTimes)).toBeLessThan(perfBudget(4));
    expect(median(saveTimes)).toBeLessThan(perfBudget(30));
    expect(median(renumberTimes)).toBeLessThan(perfBudget(16));
  });
});

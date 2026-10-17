import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  IncrementalLatexEngine,
  diffTexts,
  markDirtyBlocks,
  type LatexBlock,
  type TextEdit,
} from '../incremental-engine';

const SAMPLE = readFileSync(resolve(__dirname, '../../../../../assets/examples/sample.tex'), 'utf8');

const engines: IncrementalLatexEngine[] = [];
function createEngine(): IncrementalLatexEngine {
  const engine = new IncrementalLatexEngine();
  engines.push(engine);
  return engine;
}

afterEach(() => {
  engines.splice(0).forEach((e) => e.destroy());
});

function applyEdit(text: string, edit: TextEdit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

/** after 中不属于 before 的块 id（即本次重新解析出的块） */
function newIds(before: readonly LatexBlock[], after: readonly LatexBlock[]): string[] {
  const known = new Set(before.map((b) => b.id));
  return after.filter((b) => !known.has(b.id)).map((b) => b.id);
}

/**
 * 与块 id 无关的结构签名，用于比较增量结果与全量结果。
 * 目录块 renderKey 的第三段是 section 索引签名，包含节点 id（锚点），不同引擎实例必然不同，比较时去掉
 */
function shape(blocks: readonly LatexBlock[]) {
  return blocks.map((b) =>
    [b.kind, b.start, b.end, b.startLine, b.endLine, b.renderKey.split(':').slice(0, 2).join(':')].join('|')
  );
}

/** 确定性伪随机数 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('IncrementalLatexEngine.update', () => {
  it('单字符编辑只重新解析所在块，其余块 id 与 AST 保持不变', () => {
    const engine = createEngine();
    const first = engine.update(SAMPLE);
    const before = new Map(first.blocks.map((b) => [b.id, b]));

    const at = SAMPLE.indexOf('勾股定理');
    const edit: TextEdit = { from: at, to: at, insert: 'X' };
    const result = engine.update(applyEdit(SAMPLE, edit), [edit]);

    const added = newIds(first.blocks, result.blocks);
    expect(added).toHaveLength(1);
    expect(newIds(result.blocks, first.blocks)).toHaveLength(1);
    expect(result.reusedBlocks).toBe(first.blocks.length - 2); // 去掉前言块与被编辑块
    for (const block of result.blocks) {
      if (block.id === added[0] || block.kind === 'preamble') continue;
      expect(before.get(block.id)?.nodes).toBe(block.nodes);
    }
  });

  it('块后方的块被平移：起止偏移更新，行号随插入的换行移动', () => {
    const engine = createEngine();
    const first = engine.update(SAMPLE);
    const last = first.blocks[first.blocks.length - 1];

    const at = SAMPLE.indexOf('这是一个用于测试');
    const edit: TextEdit = { from: at, to: at, insert: '新增一行\n' };
    const result = engine.update(applyEdit(SAMPLE, edit), [edit]);
    const moved = result.blocks.find((b) => b.id === last.id);

    expect(moved).toBeDefined();
    expect(moved!.start).toBe(last.start + edit.insert.length);
    expect(moved!.startLine).toBe(last.startLine + 1);
  });

  it('插入空行把一个段落拆成两个块', () => {
    const engine = createEngine();
    const text = '甲甲\n乙乙\n\n丙\n';
    const first = engine.update(text);
    expect(first.blocks).toHaveLength(2);

    const edit: TextEdit = { from: 3, to: 3, insert: '\n' };
    const result = engine.update(applyEdit(text, edit), [edit]);
    expect(result.blocks).toHaveLength(3);
    expect(result.blocks[2].id).toBe(first.blocks[1].id);
  });

  it('同一事务中的多处编辑（旧坐标系）被正确应用', () => {
    const engine = createEngine();
    const first = engine.update(SAMPLE);
    const a = SAMPLE.indexOf('简介');
    const b = SAMPLE.indexOf('结论');
    const edits: TextEdit[] = [
      { from: a, to: a + 2, insert: '引言部分' },
      { from: b, to: b + 2, insert: '总结' },
    ];
    const next = applyEdit(applyEdit(SAMPLE, edits[1]), edits[0]);
    const result = engine.update(next, edits);

    expect(newIds(first.blocks, result.blocks)).toHaveLength(2);
    expect(shape(result.blocks)).toEqual(shape(createEngine().update(next).blocks));
  });

  it('宏定义变化使全部正文块失效；标题变化只影响前言块', () => {
    const engine = createEngine();
    const text = '\\documentclass{article}\n\\title{T}\n\\begin{document}\n\\foo\n\n正文\n\\end{document}\n';
    const first = engine.update(text);

    const titleAt = text.indexOf('{T}') + 1;
    const titleEdit: TextEdit = { from: titleAt, to: titleAt + 1, insert: 'New' };
    const titled = applyEdit(text, titleEdit);
    const second = engine.update(titled, [titleEdit]);
    expect(second.blocks[0].renderKey).not.toBe(first.blocks[0].renderKey);
    expect(second.blocks.slice(1).map((b) => b.renderKey)).toEqual(
      first.blocks.slice(1).map((b) => b.renderKey)
    );

    const macroAt = titled.indexOf('\\begin{document}');
    const macroEdit: TextEdit = { from: macroAt, to: macroAt, insert: '\\newcommand{\\foo}{bar}\n' };
    const third = engine.update(applyEdit(titled, macroEdit), [macroEdit]);
    for (let i = 1; i < third.blocks.length; i++) {
      expect(third.blocks[i].renderKey).not.toBe(second.blocks[i].renderKey);
      // 宏变化不需要重新解析正文
      expect(third.blocks[i].id).toBe(second.blocks[i].id);
    }
    expect(engine.renderBlock(third.blocks[1])).toContain('bar');
  });

  it('目录块随 section 索引变化失效', () => {
    const engine = createEngine();
    const text = '\\tableofcontents\n\n\\section{A}\n';
    const first = engine.update(text);
    expect(engine.renderBlock(first.blocks[0])).toContain('A');

    const edit: TextEdit = { from: text.length, to: text.length, insert: '\\section{B}\n' };
    const result = engine.update(applyEdit(text, edit), [edit]);
    expect(result.blocks[0].id).toBe(first.blocks[0].id);
    expect(result.blocks[0].renderKey).not.toBe(first.blocks[0].renderKey);
    expect(engine.renderBlock(result.blocks[0])).toContain('B');
  });

  it('编辑信息与文本对不上时退回前后缀比对', () => {
    const engine = createEngine();
    engine.update(SAMPLE);
    const next = SAMPLE.replace('勾股定理', '勾股');
    const result = engine.update(next, [{ from: 0, to: 0, insert: 'wrong' }]);
    expect(shape(result.blocks)).toEqual(shape(createEngine().update(next).blocks));
  });

  it('随机编辑序列（每批 1~3 处、旧坐标系）下增量结果与全量结果完全一致', () => {
    const random = createRandom(20261017);
    const snippets = [
      'x', '\n', '\n\n', '\\begin{itemize}\n', '\\end{itemize}\n', '$$', '\\[', '\\]',
      '\\section{新}\n', '{', '}', '% 注释\n', '\\begin{equation}', '\\end{equation}',
      '\\begin{document}', '\\end{document}', '\\newcommand{\\v}{w}\n', '\\tableofcontents\n',
    ];
    const engine = createEngine();
    let text = SAMPLE;
    engine.update(text);

    for (let step = 0; step < 400; step++) {
      const count = 1 + Math.floor(random() * 3);
      const points = Array.from({ length: count * 2 }, () =>
        Math.floor(random() * (text.length + 1))
      ).sort((a, b) => a - b);
      const edits: TextEdit[] = [];
      let lastTo = -1;
      for (let i = 0; i < count; i++) {
        const from = points[2 * i];
        if (from <= lastTo) continue;
        const to = random() < 0.5 ? from : Math.min(points[2 * i + 1], from + 30);
        const insert = random() < 0.8 ? snippets[Math.floor(random() * snippets.length)] : '';
        edits.push({ from, to, insert });
        lastTo = to;
      }
      // 旧坐标系下的编辑从后往前应用
      for (let i = edits.length - 1; i >= 0; i--) text = applyEdit(text, edits[i]);

      const incremental = engine.update(text, edits);
      const full = createEngine().update(text);
      expect(shape(incremental.blocks), `第 ${step} 步`).toEqual(shape(full.blocks));
      engines.pop()?.destroy();
    }
  });
});

describe('diffTexts', () => {
  it('求出最小单段编辑', () => {
    expect(diffTexts('abcdef', 'abXYef')).toEqual([{ from: 2, to: 4, insert: 'XY' }]);
    expect(diffTexts('same', 'same')).toEqual([]);
    expect(diffTexts('aaa', 'aaaa')).toEqual([{ from: 3, to: 3, insert: 'a' }]);
  });
});

describe('markDirtyBlocks', () => {
  const blocks = [
    { start: 0, end: 10, unmatched: false },
    { start: 10, end: 20, unmatched: false },
    { start: 20, end: 30, unmatched: false },
    { start: 30, end: 40, unmatched: false },
  ];

  it('标记被触及的块及其前一块', () => {
    expect(markDirtyBlocks(blocks, [{ from: 25, to: 25, insert: 'a' }])).toEqual([false, true, true, false]);
  });

  it('块边界上的编辑同时触及两侧的块', () => {
    expect(markDirtyBlocks(blocks, [{ from: 20, to: 20, insert: 'a' }])).toEqual([true, true, true, false]);
  });

  it('编辑之前的未闭合块也需要重新扫描', () => {
    const withUnmatched = blocks.map((b, i) => ({ ...b, unmatched: i === 0 }));
    expect(markDirtyBlocks(withUnmatched, [{ from: 35, to: 36, insert: '' }])).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });

  it('正文终点移动时，最后一块与所有未闭合块都需要重新扫描', () => {
    const withUnmatched = blocks.map((b, i) => ({ ...b, unmatched: i === 1 }));
    expect(markDirtyBlocks(withUnmatched, [], true)).toEqual([false, true, false, true]);
  });
});

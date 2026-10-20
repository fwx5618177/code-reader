// ================================
// 三种文本缓冲区与参考实现（普通字符串）逐步对照：随机插入、删除、替换、批量变更后，
// 内容、长度、行、偏移与位置换算都必须一致；每次编辑返回新实例，旧实例不变
// ================================

import { describe, expect, it } from 'vitest';
import {
  createAutoBuffer,
  createTextBuffer,
  recommendBufferType,
  selectBufferType,
  type ITextBuffer,
  type TextBufferType,
} from '../src';

const TYPES: TextBufferType[] = ['piece-table', 'rope', 'gap-buffer'];

/** 可复现的伪随机数 */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const PIECES = ['a', 'bc', '\n', '中文', '\n\n', 'xyz ', '😀', '\\section{x}\n'];

function lines(text: string): string[] {
  return text.split('\n');
}

/** 与参考字符串逐项比较 */
function expectSame(buffer: ITextBuffer, text: string): void {
  expect(buffer.toString()).toBe(text);
  expect(buffer.length).toBe(text.length);
  const expectedLines = lines(text);
  expect(buffer.lineCount).toBe(expectedLines.length);
  let offset = 0;
  expectedLines.forEach((line, index) => {
    expect(buffer.getLine(index)).toBe(line);
    expect(buffer.getLineOffset(index)).toBe(offset);
    offset += line.length + 1;
  });
}

describe.each(TYPES)('%s', (type) => {
  it('随机编辑 400 步后与参考字符串一致', () => {
    const next = random(TYPES.indexOf(type) + 7);
    let text = '第一行\n第二行 \\begin{itemize}\n\\item a\n\\end{itemize}\n';
    let buffer = createTextBuffer({ type, initialContent: text });

    for (let step = 0; step < 400; step++) {
      const from = Math.floor(next() * (text.length + 1));
      const to = Math.min(text.length, from + Math.floor(next() * 6));
      const insert = PIECES[Math.floor(next() * PIECES.length)]!;
      const operation = Math.floor(next() * 3);
      if (operation === 0) {
        buffer = buffer.insert(from, insert);
        text = text.slice(0, from) + insert + text.slice(from);
      } else if (operation === 1) {
        buffer = buffer.delete(from, to);
        text = text.slice(0, from) + text.slice(to);
      } else {
        buffer = buffer.replace(from, to, insert);
        text = text.slice(0, from) + insert + text.slice(to);
      }
      if (step % 50 === 0) expectSame(buffer, text);
    }
    expectSame(buffer, text);
  });

  it('positionAt 与 offsetAt 互为逆运算，slice 与字符串一致', () => {
    const text = 'ab\n中文😀\n\nend';
    const buffer = createTextBuffer({ type, initialContent: text });
    for (let offset = 0; offset <= text.length; offset++) {
      const position = buffer.positionAt(offset);
      const before = text.slice(0, offset);
      expect(position.line).toBe(before.split('\n').length - 1);
      expect(position.column).toBe(offset - (before.lastIndexOf('\n') + 1));
      expect(buffer.offsetAt(position)).toBe(offset);
    }
    expect(buffer.slice(3, 7)).toBe(text.slice(3, 7));
    expect(buffer.slice(5)).toBe(text.slice(5));
  });

  it('批量变更使用变更前坐标；编辑返回新实例，旧实例不变', () => {
    const original = createTextBuffer({ type, initialContent: 'hello world\nfoo' });
    const changed = original.apply({
      changes: [
        { from: 0, to: 5, insert: 'HELLO' },
        { from: 6, to: 11, insert: 'there' },
        { from: 12, to: 15, insert: 'bar\nbaz' },
      ],
      oldLength: 15,
      newLength: 19,
    });
    expectSame(changed, 'HELLO there\nbar\nbaz');
    expectSame(original, 'hello world\nfoo');
  });

  it('空文档', () => {
    const buffer = createTextBuffer({ type, initialContent: '' });
    expectSame(buffer, '');
    expectSame(buffer.insert(0, 'x\n'), 'x\n');
  });
});

describe('缓冲区选择', () => {
  it('按长度（string.length）选择：超过 1000 万字符用 Rope，否则 Piece Table', () => {
    expect(selectBufferType(10 * 1024 * 1024)).toBe('piece-table');
    expect(selectBufferType(10 * 1024 * 1024 + 1)).toBe('rope');
    expect(recommendBufferType('local-edit', 1000)).toBe('gap-buffer');
    expect(recommendBufferType('local-edit', 11 * 1024 * 1024)).toBe('rope');
  });

  it('createAutoBuffer 按内容长度选择实现，内容正确', () => {
    const small = createAutoBuffer('abc\ndef');
    expectSame(small, 'abc\ndef');
    expect(small.constructor.name).toBe('PieceTable');
  });
});

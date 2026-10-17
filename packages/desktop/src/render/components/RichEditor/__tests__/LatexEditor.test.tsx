// ================================
// LatexEditor 集成测试
// CodeMirror 事务 → LatexDocument → 增量引擎 → 渲染管线 的接线
// ================================

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor, fireEvent, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { LatexEditor } from '../LatexEditor';

const SOURCE = [
  '\\documentclass{article}',
  '\\title{测试文档}',
  '\\begin{document}',
  '',
  '第一段文字',
  '',
  '\\section{章节}',
  '',
  '第二段 $x^2$',
  '',
  '\\end{document}',
  '',
].join('\n');

function getView(container: HTMLElement): EditorView {
  const content = container.querySelector('.cm-content') as HTMLElement;
  const view = EditorView.findFromDOM(content);
  if (!view) throw new Error('未找到 EditorView');
  return view;
}

const blocks = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-latex-block]'));

/** 预览区（渲染管线管理的块）中的文本，不含源码编辑器 */
const previewText = (container: HTMLElement) => blocks(container).map((el) => el.textContent).join('');

describe('LatexEditor', () => {
  it('挂载与渲染不触发 onChange（不会产生错误的未保存状态）', async () => {
    const onChange = vi.fn();
    const { container } = render(<LatexEditor initialContent={SOURCE} onChange={onChange} />);

    await waitFor(() => expect(previewText(container)).toContain('第二段'));
    expect(previewText(container)).toContain('测试文档');
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('渲染中...')).toBeNull());
  });

  it('用户编辑只触发一次 onChange，预览只替换被编辑的块', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <LatexEditor initialContent={SOURCE} onChange={onChange} debounceMs={0} />
    );
    await waitFor(() => expect(previewText(container)).toContain('第二段'));
    const before = blocks(container);

    const view = getView(container);
    const at = SOURCE.indexOf('第一段') + 3;
    view.dispatch({ changes: { from: at, insert: '新增' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe(SOURCE.slice(0, at) + '新增' + SOURCE.slice(at));

    await waitFor(() => expect(previewText(container)).toContain('第一段新增文字'));
    const after = blocks(container);
    expect(after).toHaveLength(before.length);
    const changed = after.filter((element, i) => element !== before[i]);
    expect(changed).toHaveLength(1);
    expect(changed[0].textContent).toContain('第一段新增文字');
  });

  it('同一事务内的多处编辑按事务前坐标整批应用', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <LatexEditor initialContent={SOURCE} onChange={onChange} debounceMs={0} />
    );
    await waitFor(() => expect(previewText(container)).toContain('第二段'));

    const view = getView(container);
    const first = SOURCE.indexOf('第一段');
    const second = SOURCE.indexOf('第二段');
    view.dispatch({
      changes: [
        { from: first, to: first + 3, insert: 'A' },
        { from: second, to: second + 3, insert: 'B' },
      ],
    });

    expect(onChange.mock.calls[0][0]).toBe(view.state.doc.toString());
    await waitFor(() => {
      expect(previewText(container)).toContain('A文字');
      expect(previewText(container)).not.toContain('第二段');
    });
  });

  it('在源码与分栏之间切换时不重建 CodeMirror', async () => {
    const { container } = render(<LatexEditor initialContent={SOURCE} />);
    const view = getView(container);

    fireEvent.click(screen.getByTitle('源码'));
    expect(getView(container)).toBe(view);
    expect(container.querySelector('[data-latex-block]')).toBeNull();

    fireEvent.click(screen.getByTitle('分栏'));
    expect(getView(container)).toBe(view);
    await waitFor(() => expect(previewText(container)).toContain('第二段'));
  });
});

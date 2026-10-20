// ================================
// RichEditor 集成测试
// 加载 Markdown → 节点视图渲染 → 编辑后以 Markdown 回传
// ================================

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import RichEditor from '../index';

const SAMPLE = [
  '# 标题',
  '',
  '- [ ] 待办',
  '- [x] 完成',
  '',
  '$$',
  '\\frac{a}{b}',
  '$$',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  '见 [[其他笔记]]',
  '',
].join('\n');

describe('RichEditor', () => {
  it('渲染任务、公式、代码块与双向链接', async () => {
    const { container } = render(
      <RichEditor initialContent={SAMPLE} fileType="markdown" options={{ showToolbar: false }} />
    );
    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull());

    const checkboxes = container.querySelectorAll<HTMLInputElement>('input.task-item-checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[1].checked).toBe(true);
    expect(container.querySelector('.math-node-block .math-frac')).not.toBeNull();
    expect(container.querySelector('.code-block-wrapper')).not.toBeNull();
    expect(container.querySelector('[data-wiki-target="其他笔记"]')).not.toBeNull();
  });

  it('点击复选框后以 Markdown 回传内容', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <RichEditor
        initialContent={SAMPLE}
        fileType="markdown"
        onChange={onChange}
        options={{ showToolbar: false }}
      />
    );
    await waitFor(() =>
      expect(container.querySelector('input.task-item-checkbox')).not.toBeNull()
    );
    container.querySelector<HTMLInputElement>('input.task-item-checkbox')!.click();

    expect(onChange).toHaveBeenCalledTimes(1);
    const [content] = onChange.mock.calls[0];
    expect(content).toContain('- [x] 待办');
    expect(content).toContain('$$\n\\frac{a}{b}\n$$');
  });

  it('旧版 HTML 内容兼容读入', async () => {
    const { container } = render(
      <RichEditor
        initialContent="<h2>旧标题</h2><p>旧<strong>内容</strong></p>"
        fileType="markdown"
        options={{ showToolbar: false }}
      />
    );
    await waitFor(() => expect(container.querySelector('.ProseMirror h2')).not.toBeNull());
    expect(container.querySelector('.ProseMirror strong')?.textContent).toBe('内容');
  });

  it('纯文本文件不解释 Markdown 语法', async () => {
    const { container } = render(
      <RichEditor
        initialContent={'# 不是标题\n**不是粗体**'}
        fileType="plain"
        options={{ showToolbar: false }}
      />
    );
    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull());
    expect(container.querySelector('.ProseMirror h1')).toBeNull();
    expect(container.querySelector('.ProseMirror')!.textContent).toContain('# 不是标题');
  });

  it('按源码位置定位：光标移到对应的顶层块并滚动到它', async () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    const reveal = { heading: '', location: { line: 11, block: 3 } };
    const { container } = render(
      <RichEditor initialContent={SAMPLE} fileType="markdown" options={{ showToolbar: false }} revealHeading={reveal} />
    );
    await waitFor(() => expect(scrolled.length).toBeGreaterThan(0));
    // 第 4 个顶层块（从 0 计为 3）是代码块
    const codeBlock = container.querySelectorAll('.ProseMirror > *')[3];
    expect(codeBlock?.classList.contains('code-block-wrapper') || codeBlock?.querySelector('.code-block-wrapper')).toBeTruthy();
    expect(scrolled).toContain(codeBlock);
  });

  it('视图模式由上层控制：预览时显示渲染结果、编辑器不可编辑，工具栏不显示模式按钮', async () => {
    const previewHeading = (root: Element) =>
      [...root.querySelectorAll('h1')].find((heading) => !heading.closest('.ProseMirror'));
    const { container, rerender, getByTitle } = render(
      <RichEditor initialContent={SAMPLE} fileType="markdown" mode="preview" />
    );
    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull());
    expect(previewHeading(container)?.textContent).toBe('标题');
    expect(container.querySelector('.ProseMirror')!.getAttribute('contenteditable')).toBe('false');
    expect(container.querySelector('[title="预览模式"]')).toBeNull();

    rerender(<RichEditor initialContent={SAMPLE} fileType="markdown" mode="split" />);
    await waitFor(() =>
      expect(container.querySelector('.ProseMirror')!.getAttribute('contenteditable')).toBe('true')
    );
    expect(previewHeading(container)).toBeDefined();

    rerender(<RichEditor initialContent={SAMPLE} fileType="markdown" mode="edit" />);
    expect(previewHeading(container)).toBeUndefined();

    // 不受控时由工具栏切换
    rerender(<RichEditor key="uncontrolled" initialContent={SAMPLE} fileType="markdown" />);
    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull());
    getByTitle('预览模式').click();
    await waitFor(() => expect(previewHeading(container)?.textContent).toBe('标题'));
  });
});


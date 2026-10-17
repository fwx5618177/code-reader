// ================================
// RichEditor 中的块级嵌入与标题定位
// ================================

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import RichEditor from '../index';
import { LinkResolverContext, type LinkResolver } from '../../../lib/links';

/** 以固定笔记内容构造链接解析器 */
function resolverFor(notes: Record<string, string>): LinkResolver {
  return {
    resolveEmbed: (target) =>
      target in notes ? { kind: 'note', title: target, content: notes[target], format: 'markdown' } : null,
    headings: () => [],
  };
}

function renderEditor(content: string, resolver: LinkResolver, revealHeading?: { heading: string }) {
  const element = (value: LinkResolver) => (
    <LinkResolverContext.Provider value={value}>
      <RichEditor
        initialContent={content}
        fileType="markdown"
        options={{ showToolbar: false, title: '当前.md' }}
        revealHeading={revealHeading}
      />
    </LinkResolverContext.Provider>
  );
  const result = render(element(resolver));
  return { ...result, update: (value: LinkResolver) => result.rerender(element(value)) };
}

describe('RichEditor 块级嵌入', () => {
  it('只读渲染被嵌入的章节，链接目标更新后刷新', async () => {
    const { container, update } = renderEditor(
      '前文\n\n![[笔记#第二节]]\n',
      resolverFor({ 笔记: '# 第一节\n\n不显示\n\n# 第二节\n\n嵌入正文' })
    );
    await waitFor(() => expect(container.querySelector('.wiki-embed-content')).not.toBeNull());
    const node = container.querySelector<HTMLElement>('.wiki-embed-node')!;
    expect(node.contentEditable).toBe('false');
    expect(node.textContent).toContain('嵌入正文');
    expect(node.textContent).not.toContain('不显示');
    expect(node.querySelector('.wiki-embed-title')!.getAttribute('data-wiki-target')).toBe('笔记');

    update(resolverFor({ 笔记: '# 第二节\n\n已更新' }));
    await waitFor(() => expect(container.querySelector('.wiki-embed-node')!.textContent).toContain('已更新'));
  });

  it('嵌入当前文档的章节时，章节内的自嵌入提示循环', async () => {
    const { container } = renderEditor('# 一\n\n![[#一]]\n', resolverFor({}));
    await waitFor(() => expect(container.querySelector('.wiki-embed-missing')).not.toBeNull());
    expect(container.querySelector('.wiki-embed-missing')!.textContent).toContain('循环');
  });

  it('revealHeading 滚动到对应标题', async () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      renderEditor('# 开头\n\n段落\n\n## 目标 标题\n', resolverFor({}), { heading: '目标  标题' });
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    } finally {
      Element.prototype.scrollIntoView = original;
    }
    const heading = scrollIntoView.mock.instances[0] as unknown as HTMLElement;
    expect(heading.tagName).toBe('H2');
    expect(heading.textContent).toContain('目标 标题');
  });
});

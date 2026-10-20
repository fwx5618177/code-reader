// ================================
// “从这里开始”卡片：关闭后记住；从卡片打开完整的使用指南
// ================================

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import WelcomeGuide, { wasWelcomeGuideDismissed } from '..';

beforeEach(() => localStorage.clear());

describe('WelcomeGuide', () => {
  it('列出三种模式与前四步；点“开始使用”关闭并记住', () => {
    const onClose = vi.fn();
    render(<WelcomeGuide isOpen onClose={onClose} onOpenGuide={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: '从这里开始' });
    for (const mode of ['知识库', '写作', '阅读']) expect(dialog.textContent).toContain(mode);
    expect(dialog.querySelectorAll('ol li')).toHaveLength(4);

    expect(wasWelcomeGuideDismissed()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }));
    expect(onClose).toHaveBeenCalled();
    expect(wasWelcomeGuideDismissed()).toBe(true);
  });

  it('“打开完整使用指南”关闭卡片并打开指南', () => {
    const onClose = vi.fn();
    const onOpenGuide = vi.fn();
    render(<WelcomeGuide isOpen onClose={onClose} onOpenGuide={onOpenGuide} />);
    fireEvent.click(screen.getByRole('button', { name: /打开完整使用指南/ }));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenGuide).toHaveBeenCalled();
  });

  it('Esc 关闭；未打开时不渲染', () => {
    const onClose = vi.fn();
    const { rerender } = render(<WelcomeGuide isOpen onClose={onClose} onOpenGuide={vi.fn()} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    rerender(<WelcomeGuide isOpen={false} onClose={onClose} onOpenGuide={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

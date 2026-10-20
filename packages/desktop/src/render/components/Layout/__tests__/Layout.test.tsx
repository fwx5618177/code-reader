// ================================
// 应用布局的状态栏：显示当前模式、页面传入的状态与插件项，不显示与实际状态无关的固定文字
// ================================

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Layout from '..';

vi.mock('../../TitleBar', () => ({ default: () => null }));
vi.mock('../../Ribbon', () => ({ default: () => null }));
vi.mock('../../PluginHost/PluginStatusBar', () => ({ default: () => <span>插件项</span> }));

describe('Layout 状态栏', () => {
  it('显示当前模式、页面状态与插件项', () => {
    render(
      <Layout currentMode="writing" activePanel={null} onPanelChange={() => {}} statusContent={<span>120 字</span>}>
        <div>正文</div>
      </Layout>
    );
    const statusbar = screen.getByRole('contentinfo');
    expect(statusbar.textContent).toContain('写作');
    expect(statusbar.textContent).toContain('120 字');
    expect(statusbar.textContent).toContain('插件项');
    expect(statusbar.textContent).not.toContain('就绪');
  });

  it('页面没有状态时只显示模式与插件项', () => {
    render(
      <Layout currentMode="knowledge" activePanel={null} onPanelChange={() => {}}>
        <div>正文</div>
      </Layout>
    );
    expect(screen.getByRole('contentinfo').textContent).toBe('知识库插件项');
  });
});

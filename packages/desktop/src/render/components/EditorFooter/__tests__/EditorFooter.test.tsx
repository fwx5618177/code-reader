// ================================
// 编辑器底栏测试：有文档时显示字数与保存状态；没有打开的文档时只显示中性提示，
// 不展示上一篇（已关闭）文档的字数与保存状态
// ================================

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import EditorFooter from '..';

describe('EditorFooter', () => {
  it('有文档时显示字数与保存状态', () => {
    render(<EditorFooter charCount={120} wordCount={80} isDirty />);
    expect(screen.getByText('120 字符')).toBeTruthy();
    expect(screen.getByText('80 字')).toBeTruthy();
    expect(screen.getByText('● 未保存')).toBeTruthy();
  });

  it('没有打开的文档时显示中性状态，忽略残留的统计与保存状态', () => {
    render(
      <EditorFooter hasDocument={false} charCount={120} wordCount={80} isDirty lastSavedAt={new Date()}>
        <button>操作</button>
      </EditorFooter>
    );
    expect(screen.getByText('未打开文档')).toBeTruthy();
    expect(screen.queryByText('120 字符')).toBeNull();
    expect(screen.queryByText('80 字')).toBeNull();
    expect(screen.queryByText('● 未保存')).toBeNull();
    expect(screen.queryByText(/已保存/)).toBeNull();
    expect(screen.getByText('⌘S')).toBeTruthy();
  });
});

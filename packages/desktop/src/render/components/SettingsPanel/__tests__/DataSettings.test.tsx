// ================================
// 数据设置测试：导入预览 → 执行 → 结果并通知刷新；备份列表与立即备份
// ================================

import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportSource } from '../../../types/electron';

const runImport = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/transfer/importer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/transfer/importer')>()),
  runImport,
}));
const notifyKnowledgeChanged = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/knowledge/changes', () => ({ notifyKnowledgeChanged }));

import { DataSettings } from '../DataSettings';

const source: ImportSource = {
  id: 'src',
  kind: 'obsidian',
  name: '我的库',
  files: [
    { path: '笔记/a.md', size: 3, text: '#标签 内容' },
    { path: '图.png', size: 10 },
    { path: '画布.canvas', size: 2, text: '{}' },
  ],
};

const backup = {
  list: vi.fn(),
  create: vi.fn(),
  restore: vi.fn(),
  restoreFromFile: vi.fn(),
  remove: vi.fn(),
  openFolder: vi.fn(),
  exportFull: vi.fn(),
  restoreFull: vi.fn(),
};
const transfer = { pickImportSource: vi.fn(), finishImport: vi.fn(), pickExportDirectory: vi.fn(), finishExport: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  backup.list.mockResolvedValue([
    { fileName: 'knowledge-backup-1.db', path: '/b/1.db', size: 2048, createdAt: '2026-10-17T01:00:00.000Z' },
  ]);
  backup.create.mockResolvedValue({ fileName: 'knowledge-backup-2.db', path: '/b/2.db', size: 4096, createdAt: '2026-10-17T02:00:00.000Z' });
  transfer.pickImportSource.mockResolvedValue(source);
  transfer.finishImport.mockResolvedValue(undefined);
  runImport.mockImplementation(async (_source, plan, onProgress: (p: { done: number; total: number }) => void) => {
    onProgress({ done: plan.entries.length, total: plan.entries.length });
    return { folderName: '导入 · Obsidian · 我的库', created: 2, attachments: 1, renamed: 0, failed: [], warnings: plan.warnings };
  });
  vi.stubGlobal('electron', { backup, transfer });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DataSettings', () => {
  it('选择来源后预览统计，确认导入后显示结果、清理来源并通知刷新', async () => {
    await act(async () => {
      render(<DataSettings />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Obsidian/ }));
    });
    expect(transfer.pickImportSource).toHaveBeenCalledWith('obsidian');
    const preview = screen.getByLabelText('导入预览');
    expect(preview.textContent).toContain('将导入 1 篇笔记、1 个附件，1 个标签，1 个文件夹');
    expect(within(preview).getByText(/跳过 1 个不支持的文件/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '开始导入' }));
    });
    expect(runImport).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('导入结果').textContent).toContain('已导入 2 个条目（其中附件 1 个）到「导入 · Obsidian · 我的库」');
    expect(transfer.finishImport).toHaveBeenCalledWith('src');
    expect(notifyKnowledgeChanged).toHaveBeenCalled();
  });

  it('取消预览时清理来源', async () => {
    await act(async () => {
      render(<DataSettings />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Obsidian/ }));
    });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(transfer.finishImport).toHaveBeenCalledWith('src');
    expect(screen.queryByLabelText('导入预览')).toBeNull();
  });

  it('列出备份，立即备份后刷新列表', async () => {
    await act(async () => {
      render(<DataSettings />);
    });
    expect(within(screen.getByLabelText('备份列表')).getByText('knowledge-backup-1.db')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即备份' }));
    });
    expect(backup.create).toHaveBeenCalled();
    expect(screen.getByText(/已备份：knowledge-backup-2.db（4.0 KB）/)).toBeTruthy();
    expect(backup.list).toHaveBeenCalledTimes(2);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '恢复 knowledge-backup-1.db' }));
    });
    expect(backup.restore).toHaveBeenCalledWith('knowledge-backup-1.db');
  });
});

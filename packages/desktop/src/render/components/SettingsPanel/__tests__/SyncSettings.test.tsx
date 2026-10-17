// ================================
// 同步设置测试：选择新文件夹并设置口令后连接、口令不一致报错；已连接时立即同步与上次结果说明
// ================================

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncStatus } from '../../../types/electron';

const refreshAfterSync = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/sync/refresh', () => ({ refreshAfterSync }));

import { describeLastSync, SyncSettings } from '../SyncSettings';

const disconnected: SyncStatus = {
  folder: null,
  folderId: null,
  enabled: false,
  intervalMinutes: 15,
  encrypted: false,
  lastSyncAt: null,
  lastResult: null,
  lastError: null,
  deviceId: 'me',
  deviceName: '我的电脑',
  running: false,
  needsPassphrase: false,
  devices: [],
};
const connected: SyncStatus = {
  ...disconnected,
  folder: '/Dropbox/kb',
  folderId: 'f',
  enabled: true,
  encrypted: true,
  lastSyncAt: '2026-10-17T01:00:00.000Z',
  lastResult: { exported: 2, applied: 3, conflicts: 1, deferred: 0 },
  devices: [
    { deviceId: 'me', name: '我的电脑', lastSeq: 4, updatedAt: '2026-10-17T01:00:00.000Z' },
    { deviceId: 'other', name: '笔记本', lastSeq: 7, updatedAt: '2026-10-17T00:00:00.000Z' },
  ],
};

const sync = {
  getStatus: vi.fn(),
  chooseFolder: vi.fn(),
  connect: vi.fn(),
  providePassphrase: vi.fn(),
  disconnect: vi.fn(),
  update: vi.fn(),
  runNow: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('electron', { sync });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('describeLastSync', () => {
  it('结果、冲突、推迟与错误', () => {
    expect(describeLastSync(connected)).toContain('发出 2 项修改，收到 3 项修改，1 处冲突');
    expect(describeLastSync({ ...connected, lastError: '需要输入同步口令' })).toContain('上次同步失败');
    expect(describeLastSync({ ...connected, lastResult: { exported: 0, applied: 0, conflicts: 0, deferred: 2 } })).toContain(
      '2 批修改等待附件同步完成'
    );
  });
});

describe('SyncSettings', () => {
  it('新文件夹：口令需要确认，连接后刷新被修改的条目', async () => {
    sync.getStatus.mockResolvedValue(disconnected);
    sync.chooseFolder.mockResolvedValue({ folder: '/iCloud/kb', exists: false, encrypted: false, devices: 0 });
    sync.connect.mockResolvedValue({ exported: 5, applied: 1, conflicts: 0, deferred: 0, changedItemIds: ['n1'], devices: [] });
    await act(async () => {
      render(<SyncSettings />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '选择同步文件夹…' }));
    });
    expect(screen.getByText('新的同步文件夹，连接后上传本机的全部内容')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('同步口令'), { target: { value: 'secret' } });
    fireEvent.change(screen.getByLabelText('确认同步口令'), { target: { value: 'other' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '创建并同步' }));
    });
    expect(screen.getByRole('alert').textContent).toContain('两次输入的口令不一致');
    expect(sync.connect).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('确认同步口令'), { target: { value: 'secret' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '创建并同步' }));
    });
    expect(sync.connect).toHaveBeenCalledWith({ folder: '/iCloud/kb', passphrase: 'secret' });
    expect(refreshAfterSync).toHaveBeenCalledWith(['n1']);
  });

  it('已连接：显示设备与上次结果，可立即同步', async () => {
    sync.getStatus.mockResolvedValue(connected);
    sync.runNow.mockResolvedValue({ exported: 0, applied: 0, conflicts: 0, deferred: 0, changedItemIds: [], devices: [] });
    await act(async () => {
      render(<SyncSettings />);
    });
    expect(screen.getByText('/Dropbox/kb')).toBeTruthy();
    expect(screen.getByText('我的电脑（本机）')).toBeTruthy();
    expect(screen.getByText('笔记本')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即同步' }));
    });
    expect(sync.runNow).toHaveBeenCalled();
    expect(refreshAfterSync).not.toHaveBeenCalled();
  });
});

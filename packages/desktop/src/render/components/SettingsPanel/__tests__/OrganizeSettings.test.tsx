// ================================
// 定期整理设置测试：读取状态、开关与间隔写回主进程、状态说明
// ================================

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrganizeStatus } from '../../../types/electron';
import { describeOrganizeStatus, OrganizeSettings } from '../OrganizeSettings';

const base: OrganizeStatus = {
  enabled: false,
  intervalDays: 7,
  lastRunAt: null,
  lastTaskId: null,
  newItemCount: 0,
  nextRunAt: null,
};

describe('describeOrganizeStatus', () => {
  const now = new Date('2026-10-17T00:00:00.000Z');
  it('未开启、无新条目、到期、未到期', () => {
    expect(describeOrganizeStatus(base, now)).toContain('未开启');
    const enabled = { ...base, enabled: true, lastRunAt: '2026-10-10T00:00:00.000Z', nextRunAt: '2026-10-17T00:00:00.000Z' };
    expect(describeOrganizeStatus(enabled, now)).toContain('有新条目后才会整理');
    expect(describeOrganizeStatus({ ...enabled, newItemCount: 3 }, now)).toContain('已到期');
    expect(describeOrganizeStatus({ ...enabled, newItemCount: 3, nextRunAt: '2026-10-20T00:00:00.000Z' }, now)).toContain(
      '下次整理时间'
    );
  });
});

describe('OrganizeSettings', () => {
  const getStatus = vi.fn();
  const update = vi.fn();

  beforeEach(() => {
    getStatus.mockResolvedValue(base);
    update.mockImplementation(async (input: Partial<OrganizeStatus>) => ({ ...base, ...input }));
    vi.stubGlobal('electron', { organize: { getStatus, update } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('开启后可选择间隔，均写回主进程', async () => {
    await act(async () => {
      render(<OrganizeSettings />);
    });
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.disabled).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'));
    });
    expect(update).toHaveBeenCalledWith({ enabled: true });
    expect(select.disabled).toBe(false);

    await act(async () => {
      fireEvent.change(select, { target: { value: '1' } });
    });
    expect(update).toHaveBeenLastCalledWith({ intervalDays: 1 });
  });
});

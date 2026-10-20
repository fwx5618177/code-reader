// ================================
// 定期整理建议测试：设置规范化、到期判断，以及调度检查（到期 + 有新条目 + AI 可用时才提交）
// ================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => new Map<string, string>());
const state = vi.hoisted(() => ({ newItems: 0, providers: [] as unknown[], defaultProviderId: undefined as string | undefined }));
const categorizeLibrary = vi.hoisted(() => vi.fn(() => 'task-1'));

vi.mock('electron', () => ({
  app: { getPath: () => '/nonexistent-user-data' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  Notification: { isSupported: () => false },
}));
vi.mock('../../database/sqlite', () => ({
  getSQLiteService: () => ({
    get: (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM app_settings')) {
        const value = settings.get(params[0] as string);
        return value === undefined ? undefined : { value };
      }
      return { count: state.newItems };
    },
    run: (_sql: string, params: unknown[]) => settings.set(params[0] as string, params[1] as string),
  }),
}));
vi.mock('../../ai/ai-service', () => ({
  getAIService: () => ({
    getConfigSnapshot: () => ({ providers: state.providers, defaultProviderId: state.defaultProviderId }),
  }),
}));
vi.mock('../agent-executor', () => ({ getAgentExecutor: () => ({ on: vi.fn(), categorizeLibrary }) }));

import {
  getOrganizeScheduler,
  isOrganizeDue,
  nextOrganizeAt,
  normalizeOrganizeSchedule,
} from '../organize-schedule';

const DAY = 24 * 60 * 60 * 1000;

describe('normalizeOrganizeSchedule', () => {
  it('非法或缺失字段取默认值（关闭、每周）', () => {
    expect(normalizeOrganizeSchedule(null)).toEqual({ enabled: false, intervalDays: 7, lastRunAt: null, lastTaskId: null });
    expect(normalizeOrganizeSchedule({ enabled: 'yes', intervalDays: 5, lastRunAt: 'bad' })).toMatchObject({
      enabled: false,
      intervalDays: 7,
      lastRunAt: null,
    });
    expect(normalizeOrganizeSchedule({ enabled: true, intervalDays: 3 })).toMatchObject({ enabled: true, intervalDays: 3 });
  });
});

describe('isOrganizeDue', () => {
  const lastRunAt = '2026-10-01T00:00:00.000Z';
  const schedule = { enabled: true, intervalDays: 7 as const, lastRunAt, lastTaskId: null };

  it('到期且有新条目时才整理', () => {
    const due = new Date(Date.parse(lastRunAt) + 7 * DAY);
    expect(nextOrganizeAt(schedule)?.toISOString()).toBe(due.toISOString());
    expect(isOrganizeDue(schedule, 3, due)).toBe(true);
    expect(isOrganizeDue(schedule, 0, due)).toBe(false);
    expect(isOrganizeDue(schedule, 3, new Date(due.getTime() - 1))).toBe(false);
    expect(isOrganizeDue({ ...schedule, enabled: false }, 3, due)).toBe(false);
  });
});

describe('OrganizeScheduler', () => {
  beforeEach(() => {
    settings.clear();
    state.newItems = 0;
    state.providers = [];
    state.defaultProviderId = undefined;
    categorizeLibrary.mockClear();
  });

  it('开启时以当前时间为起点，切换间隔不改变开关', () => {
    const scheduler = getOrganizeScheduler();
    const enabled = scheduler.update({ enabled: true });
    expect(enabled.enabled).toBe(true);
    expect(enabled.lastRunAt).not.toBeNull();
    const changed = scheduler.update({ intervalDays: 1 });
    expect(changed).toMatchObject({ enabled: true, intervalDays: 1, lastRunAt: enabled.lastRunAt });
  });

  it('到期、有新条目且 AI 可用时提交整库归类并记录任务；AI 不可用时不推进时间', () => {
    const scheduler = getOrganizeScheduler();
    settings.set(
      'organize.schedule',
      JSON.stringify({ enabled: true, intervalDays: 1, lastRunAt: '2026-10-01T00:00:00.000Z', lastTaskId: null })
    );
    state.newItems = 2;
    const now = new Date('2026-10-03T00:00:00.000Z');

    expect(scheduler.check(now)).toBe(false);
    expect(categorizeLibrary).not.toHaveBeenCalled();
    expect(scheduler.getStatus().lastRunAt).toBe('2026-10-01T00:00:00.000Z');

    state.providers = [{ id: 'p1', hasApiKey: true, requiresApiKey: true }];
    state.defaultProviderId = 'p1';
    expect(scheduler.check(now)).toBe(true);
    expect(categorizeLibrary).toHaveBeenCalledTimes(1);
    expect(scheduler.getStatus()).toMatchObject({ lastRunAt: now.toISOString(), lastTaskId: 'task-1' });
  });

  it('没有新条目时不提交', () => {
    const scheduler = getOrganizeScheduler();
    settings.set('organize.schedule', JSON.stringify({ enabled: true, intervalDays: 1, lastRunAt: '2026-10-01T00:00:00.000Z' }));
    state.providers = [{ id: 'p1', hasApiKey: true, requiresApiKey: true }];
    state.defaultProviderId = 'p1';
    expect(scheduler.check(new Date('2026-10-03T00:00:00.000Z'))).toBe(false);
    expect(categorizeLibrary).not.toHaveBeenCalled();
  });
});

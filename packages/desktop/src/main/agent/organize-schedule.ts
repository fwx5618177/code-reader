// ================================
// 定期整理建议：按设定的间隔，在知识库有新条目时自动提交一次整库自动归类
// 结果与手动触发的整库归类相同——只生成待审阅建议（categorization_proposals），由用户在审阅面板中决定。
// 设置保存在当前知识库的 app_settings（各知识库独立）；调度器每 30 分钟以及启动、切换知识库后检查一次。
// ================================

import { readFileSync } from 'fs';
import { join } from 'path';
import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import { getSQLiteService } from '../database/sqlite';
import { getAIService } from '../ai/ai-service';
import { getAgentExecutor } from './agent-executor';
import { isRecord } from './json-output';

/** app_settings 中的键 */
const SCHEDULE_SETTING_KEY = 'organize.schedule';

/** 可选的整理间隔（天） */
export const ORGANIZE_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;
export type OrganizeIntervalDays = (typeof ORGANIZE_INTERVAL_DAYS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
/** 定期检查的间隔 */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** 启动或切换知识库后首次检查的延迟（让出启动时的处理） */
const INITIAL_CHECK_DELAY_MS = 60 * 1000;

export interface OrganizeSchedule {
  enabled: boolean;
  intervalDays: OrganizeIntervalDays;
  /** 上次自动提交整理的时间；新条目以此为界。开启时记为开启时间，首次整理在一个间隔之后 */
  lastRunAt: string | null;
  /** 上次自动提交的任务 ID（完成时据此发送提醒） */
  lastTaskId: string | null;
}

/** 设置页展示的状态 */
export interface OrganizeStatus extends OrganizeSchedule {
  /** 上次整理之后新增的条目数 */
  newItemCount: number;
  /** 预计下次检查到期的时间（未开启时为 null） */
  nextRunAt: string | null;
}

/** 规范化（非法或缺失字段取默认值） */
export function normalizeOrganizeSchedule(raw: unknown): OrganizeSchedule {
  const value = isRecord(raw) ? raw : {};
  const interval = ORGANIZE_INTERVAL_DAYS.find((days) => days === value.intervalDays) ?? 7;
  const lastRunAt = typeof value.lastRunAt === 'string' && !Number.isNaN(Date.parse(value.lastRunAt)) ? value.lastRunAt : null;
  return {
    enabled: value.enabled === true,
    intervalDays: interval,
    lastRunAt,
    lastTaskId: typeof value.lastTaskId === 'string' ? value.lastTaskId : null,
  };
}

/** 下次到期时间 */
export function nextOrganizeAt(schedule: OrganizeSchedule): Date | null {
  if (!schedule.enabled || !schedule.lastRunAt) return null;
  return new Date(Date.parse(schedule.lastRunAt) + schedule.intervalDays * DAY_MS);
}

/** 是否应当提交整理：已开启、到期，且上次整理后有新条目 */
export function isOrganizeDue(schedule: OrganizeSchedule, newItemCount: number, now: Date): boolean {
  const next = nextOrganizeAt(schedule);
  return !!next && next.getTime() <= now.getTime() && newItemCount > 0;
}

// ================================
// 读写（当前知识库）
// ================================

function readSchedule(): OrganizeSchedule {
  const row = getSQLiteService().get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [
    SCHEDULE_SETTING_KEY,
  ]);
  if (!row) return normalizeOrganizeSchedule(null);
  try {
    return normalizeOrganizeSchedule(JSON.parse(row.value));
  } catch (error) {
    console.warn('[Organize] 定期整理设置无法解析，使用默认值:', error);
    return normalizeOrganizeSchedule(null);
  }
}

function writeSchedule(schedule: OrganizeSchedule): void {
  getSQLiteService().run(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [SCHEDULE_SETTING_KEY, JSON.stringify(schedule)]
  );
}

/** 上次整理之后新建的未删除条目数（未整理过时统计全部） */
function countNewItems(since: string | null): number {
  const row = since
    ? getSQLiteService().get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM knowledge_items
         WHERE is_deleted = 0 AND julianday(created_at) > julianday(?)`,
        [since]
      )
    : getSQLiteService().get<{ count: number }>(`SELECT COUNT(*) AS count FROM knowledge_items WHERE is_deleted = 0`);
  return row?.count ?? 0;
}

function toStatus(schedule: OrganizeSchedule): OrganizeStatus {
  return {
    ...schedule,
    newItemCount: countNewItems(schedule.lastRunAt),
    nextRunAt: nextOrganizeAt(schedule)?.toISOString() ?? null,
  };
}

/** AI 可用：设置中开启了 AI，且默认对话服务商可用（与渲染进程 checkAiAvailability 一致） */
function aiAvailable(): boolean {
  try {
    const raw = JSON.parse(readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf-8')) as unknown;
    if (isRecord(raw) && raw.enableAI === false) return false;
  } catch {
    // 设置文件不存在或损坏时按默认（开启）处理
  }
  const { providers, defaultProviderId } = getAIService().getConfigSnapshot();
  return providers.some((p) => p.id === defaultProviderId && (p.hasApiKey || !p.requiresApiKey));
}

// ================================
// 调度
// ================================

class OrganizeScheduler {
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;

  constructor() {
    // 自动提交的整理完成后，窗口不在前台时发送系统通知
    getAgentExecutor().on('taskCompleted', (event: { taskId: string; type: string; result: unknown }) => {
      if (event.type !== 'categorize') return;
      try {
        if (readSchedule().lastTaskId !== event.taskId) return;
      } catch {
        return;
      }
      this.notifyCompleted(event.result);
    });
  }

  start(): void {
    this.stop();
    this.initialTimer = setTimeout(() => this.check(), INITIAL_CHECK_DELAY_MS);
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }

  /** 切换知识库后按新库的设置重新计时 */
  restart(): void {
    this.start();
  }

  /** 检查一次；到期且有新条目、AI 可用时提交整库归类。返回是否提交 */
  check(now: Date = new Date()): boolean {
    try {
      const schedule = readSchedule();
      if (!isOrganizeDue(schedule, countNewItems(schedule.lastRunAt), now)) return false;
      // AI 不可用时不推进时间，配置好后下次检查即补上
      if (!aiAvailable()) return false;
      const taskId = getAgentExecutor().categorizeLibrary();
      writeSchedule({ ...schedule, lastRunAt: now.toISOString(), lastTaskId: taskId });
      console.log('[Organize] 已提交定期整理:', taskId);
      return true;
    } catch (error) {
      // 切换知识库期间数据库可能暂时关闭，下次检查再试
      console.error('[Organize] 检查定期整理失败:', error);
      return false;
    }
  }

  getStatus(): OrganizeStatus {
    return toStatus(readSchedule());
  }

  /** 更新开关与间隔；开启时若从未整理过，以当前时间为起点 */
  update(input: { enabled?: boolean; intervalDays?: number }): OrganizeStatus {
    const current = readSchedule();
    const next = normalizeOrganizeSchedule({
      ...current,
      enabled: input.enabled ?? current.enabled,
      intervalDays: input.intervalDays ?? current.intervalDays,
    });
    if (next.enabled && !next.lastRunAt) next.lastRunAt = new Date().toISOString();
    writeSchedule(next);
    return toStatus(next);
  }

  private notifyCompleted(result: unknown): void {
    const focused = BrowserWindow.getAllWindows().some((window) => window.isFocused());
    if (focused || !Notification.isSupported()) return;
    const proposals =
      isRecord(result) && typeof result.itemProposals === 'number' && typeof result.tagMergeProposals === 'number'
        ? result.itemProposals + result.tagMergeProposals
        : 0;
    if (proposals === 0) return;
    const notification = new Notification({
      title: '定期整理完成',
      body: `生成了 ${proposals} 条归类建议，打开知识库的“待审阅归类”查看`,
    });
    notification.on('click', () => {
      const [window] = BrowserWindow.getAllWindows();
      if (!window) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    });
    notification.show();
  }
}

let scheduler: OrganizeScheduler | null = null;

export function getOrganizeScheduler(): OrganizeScheduler {
  if (!scheduler) scheduler = new OrganizeScheduler();
  return scheduler;
}

const CHANNELS = ['organize:getStatus', 'organize:update'] as const;

export function registerOrganizeHandlers(): void {
  ipcMain.handle('organize:getStatus', () => getOrganizeScheduler().getStatus());
  ipcMain.handle('organize:update', (_event, input: unknown) => {
    const value = isRecord(input) ? input : {};
    return getOrganizeScheduler().update({
      enabled: typeof value.enabled === 'boolean' ? value.enabled : undefined,
      intervalDays: typeof value.intervalDays === 'number' ? value.intervalDays : undefined,
    });
  });
}

export function cleanupOrganizeHandlers(): void {
  getOrganizeScheduler().stop();
  for (const channel of CHANNELS) ipcMain.removeHandler(channel);
}

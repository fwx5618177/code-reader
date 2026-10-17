// ================================
// 版本保留策略测试：分层抽样（全部保留 / 每天 / 每周 / 每月）与策略规范化
// ================================

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VERSION_RETENTION,
  normalizeRetentionPolicy,
  selectVersionsToPrune,
  type RetentionCandidate,
} from '../version-retention';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-06-15T12:00:00.000Z');

/** 按时间升序构造版本：版本号依次递增，id 为 v<版本号> */
function versions(...createdAt: Array<string | Date>): RetentionCandidate[] {
  return createdAt.map((time, index) => ({
    id: `v${index + 1}`,
    versionNumber: index + 1,
    createdAt: typeof time === 'string' ? time : time.toISOString(),
  }));
}

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

/** 以 UTC 划分日历，结果与运行环境的时区无关 */
function prune(list: RetentionCandidate[], now = NOW, policy = DEFAULT_VERSION_RETENTION): string[] {
  return selectVersionsToPrune(list, policy, now, 'UTC').sort();
}

describe('selectVersionsToPrune', () => {
  it('空列表与单个版本不删除任何内容', () => {
    expect(prune([])).toEqual([]);
    expect(prune(versions('2020-01-01T00:00:00.000Z'))).toEqual([]);
  });

  it('最近 24 小时内的版本全部保留', () => {
    const list = versions(ago(23 * HOUR), ago(10 * HOUR), ago(HOUR), ago(60 * 1000), NOW);
    expect(prune(list)).toEqual([]);
  });

  it('全保留窗口的边界：恰好 24 小时前的版本进入每日抽样', () => {
    // 两个版本同在 6 月 14 日（UTC），较旧的被删除
    const list = versions(ago(24 * HOUR + 60 * 1000), ago(24 * HOUR), NOW);
    expect(prune(list)).toEqual(['v1']);
  });

  it('30 天内每天保留当天最后一个版本', () => {
    const list = versions(
      '2026-06-10T08:00:00.000Z',
      '2026-06-10T09:00:00.000Z',
      '2026-06-10T23:59:59.000Z',
      '2026-06-11T00:00:00.000Z',
      '2026-06-12T10:00:00.000Z',
      NOW
    );
    // 6 月 10 日保留 v3，6 月 11、12 日各只有一个
    expect(prune(list)).toEqual(['v1', 'v2']);
  });

  it('每周层按 ISO 周（周一开始）划分，跨月的同一周只保留一个', () => {
    // 2026-03-30 周一与 2026-04-02 周四同属 2026-W14；2026-03-29 周日属于上一周
    const list = versions('2026-03-29T10:00:00.000Z', '2026-03-30T10:00:00.000Z', '2026-04-02T10:00:00.000Z', NOW);
    expect(prune(list)).toEqual(['v2']);
  });

  it('每周层跨年：12 月 29 日（周一）与 1 月 1 日同属下一年的第 1 周', () => {
    const now = new Date('2026-04-20T12:00:00.000Z');
    const list = versions(
      '2025-12-28T10:00:00.000Z', // 周日，2025-W52
      '2025-12-29T10:00:00.000Z', // 周一，2026-W1
      '2026-01-01T10:00:00.000Z', // 周四，2026-W1
      now
    );
    expect(prune(list, now)).toEqual(['v2']);
  });

  it('超过每周层的版本每月保留最后一个，不同月份各保留一个', () => {
    const list = versions(
      '2025-09-01T10:00:00.000Z',
      '2025-09-30T23:00:00.000Z',
      '2025-10-01T01:00:00.000Z',
      '2025-10-15T10:00:00.000Z',
      '2025-11-03T10:00:00.000Z',
      NOW
    );
    expect(prune(list)).toEqual(['v1', 'v3']);
  });

  it('跨层级的版本分别按各自的层级抽样（Time Machine 式）', () => {
    const list = versions(
      '2025-01-05T00:00:00.000Z', // 每月：2025-01
      '2025-01-20T00:00:00.000Z', // 每月：2025-01（保留）
      '2026-03-02T00:00:00.000Z', // 每周：2026-W10
      '2026-03-04T00:00:00.000Z', // 每周：2026-W10（保留）
      '2026-06-01T08:00:00.000Z', // 每天：6 月 1 日
      '2026-06-01T20:00:00.000Z', // 每天：6 月 1 日（保留）
      ago(2 * HOUR), // 全部保留
      ago(HOUR), // 全部保留
      NOW
    );
    expect(prune(list)).toEqual(['v1', 'v3', 'v5']);
  });

  it('最新版本永远保留，并代表所在的时间桶', () => {
    // 文档已很久未修改：最新版本也在每月层，同月更旧的版本被删除
    const list = versions('2025-01-01T00:00:00.000Z', '2025-01-10T00:00:00.000Z', '2025-01-20T00:00:00.000Z');
    expect(prune(list)).toEqual(['v1', 'v2']);
  });

  it('按版本号判断新旧，与输入顺序无关', () => {
    const list = versions('2026-06-10T08:00:00.000Z', '2026-06-10T09:00:00.000Z', NOW).reverse();
    expect(prune(list)).toEqual(['v1']);
  });

  it('无法解析或晚于当前时间（时钟回拨）的版本保留', () => {
    const list = versions('not-a-date', '2026-06-10T08:00:00.000Z', '2026-06-10T09:00:00.000Z', '2026-07-01T00:00:00.000Z');
    expect(prune(list)).toEqual(['v2']);
  });

  it('自然日按指定时区划分', () => {
    // 15:30Z 与 16:30Z：上海（UTC+8）分属 3 月 10 日 23:30 与 3 月 11 日 00:30；纽约（夏令时 UTC-4）同为 3 月 10 日
    const now = new Date('2026-03-20T00:00:00.000Z');
    const list = versions('2026-03-10T15:30:00.000Z', '2026-03-10T16:30:00.000Z', now);
    const policy = DEFAULT_VERSION_RETENTION;
    expect(selectVersionsToPrune(list, policy, now, 'Asia/Shanghai')).toEqual([]);
    expect(selectVersionsToPrune(list, policy, now, 'America/New_York')).toEqual(['v1']);
    expect(selectVersionsToPrune(list, policy, now, 'UTC')).toEqual(['v1']);
  });

  it('月的边界按时区划分', () => {
    // 2026-02-28T20:00Z 在上海已是 3 月 1 日，与 3 月 2 日同月
    const now = new Date('2026-12-01T00:00:00.000Z');
    const list = versions('2026-02-28T20:00:00.000Z', '2026-03-02T10:00:00.000Z', now);
    const monthly = { keepAllHours: 24, dailyDays: 30, weeklyWeeks: 5 };
    expect(selectVersionsToPrune(list, monthly, now, 'Asia/Shanghai')).toEqual(['v1']);
    expect(selectVersionsToPrune(list, monthly, now, 'UTC')).toEqual([]);
  });

  it('周的边界按时区划分', () => {
    // 3 月 1 日（周日）15:30Z 与 16:30Z：UTC 同属一周；上海分别是周日 23:30 与周一 00:30
    const list = versions('2026-03-01T15:30:00.000Z', '2026-03-01T16:30:00.000Z', NOW);
    expect(selectVersionsToPrune(list, DEFAULT_VERSION_RETENTION, NOW, 'Asia/Shanghai')).toEqual([]);
    expect(selectVersionsToPrune(list, DEFAULT_VERSION_RETENTION, NOW, 'UTC')).toEqual(['v1']);
  });

  it('策略参数可调：全部保留 0 小时时立即按天抽样', () => {
    const policy = { keepAllHours: 0, dailyDays: 1, weeklyWeeks: 1 };
    const list = versions(ago(3 * HOUR), ago(2 * HOUR), NOW);
    expect(prune(list, NOW, policy)).toEqual(['v1', 'v2']);
  });
});

describe('normalizeRetentionPolicy', () => {
  it('缺省或无法解析时使用默认值', () => {
    expect(normalizeRetentionPolicy(null)).toEqual(DEFAULT_VERSION_RETENTION);
    expect(normalizeRetentionPolicy({ keepAllHours: Number.NaN })).toEqual(DEFAULT_VERSION_RETENTION);
  });

  it('取整并限定范围', () => {
    expect(normalizeRetentionPolicy({ keepAllHours: -5, dailyDays: 7.6, weeklyWeeks: 9999 })).toEqual({
      keepAllHours: 0,
      dailyDays: 8,
      weeklyWeeks: 520,
    });
  });

  it('后一层级的范围不短于前一层级', () => {
    expect(normalizeRetentionPolicy({ keepAllHours: 72, dailyDays: 1, weeklyWeeks: 1 })).toEqual({
      keepAllHours: 72,
      dailyDays: 3,
      weeklyWeeks: 1,
    });
    expect(normalizeRetentionPolicy({ keepAllHours: 24, dailyDays: 60, weeklyWeeks: 2 })).toEqual({
      keepAllHours: 24,
      dailyDays: 60,
      weeklyWeeks: 9,
    });
  });
});

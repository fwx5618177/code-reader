// ================================
// 版本保留策略（类似 Time Machine 的分层抽样）
// - 最近 keepAllHours 小时内的版本全部保留
// - 此后到 dailyDays 天：每个自然日保留最后一个版本
// - 此后到 weeklyWeeks 周：每个 ISO 周（周一开始）保留最后一个版本
// - 更早：每个自然月保留最后一个版本
// - 最新版本永远保留
// 自然日/周/月默认按本机时区划分。纯函数，不依赖数据库，便于测试
// ================================

/** 保留策略参数 */
export interface VersionRetentionPolicy {
  /** 最近多少小时内的版本全部保留 */
  keepAllHours: number;
  /** 多少天内每天保留一个 */
  dailyDays: number;
  /** 多少周内每周保留一个（更早的每月保留一个） */
  weeklyWeeks: number;
}

export const DEFAULT_VERSION_RETENTION: VersionRetentionPolicy = {
  keepAllHours: 24,
  dailyDays: 30,
  weeklyWeeks: 26,
};

/** 参与抽样的版本（只需编号与创建时间） */
export interface RetentionCandidate {
  id: string;
  versionNumber: number;
  /** ISO 时间 */
  createdAt: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** 取整并限定范围；非数字时使用默认值 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, number));
}

/**
 * 规范化策略：各层级的时间范围依次不短于前一层（每天层至少覆盖全保留层，每周层至少覆盖每天层）
 */
export function normalizeRetentionPolicy(input: Partial<VersionRetentionPolicy> | null | undefined): VersionRetentionPolicy {
  const keepAllHours = clampInt(input?.keepAllHours, 0, 24 * 365, DEFAULT_VERSION_RETENTION.keepAllHours);
  const dailyDays = clampInt(input?.dailyDays, Math.ceil(keepAllHours / 24), 3650, DEFAULT_VERSION_RETENTION.dailyDays);
  const weeklyWeeks = clampInt(input?.weeklyWeeks, Math.ceil(dailyDays / 7), 520, DEFAULT_VERSION_RETENTION.weeklyWeeks);
  return { keepAllHours, dailyDays, weeklyWeeks };
}

/** 日历日期（按指定时区） */
interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** 按时区取日历日期的函数（未指定时区时为本机时区） */
function calendarReader(timeZone: string | undefined): (date: Date) => CalendarDate {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
  return (date) => {
    const parts: Record<string, number> = {};
    for (const part of formatter.formatToParts(date)) {
      if (part.type === 'year' || part.type === 'month' || part.type === 'day') parts[part.type] = Number(part.value);
    }
    return { year: parts.year, month: parts.month, day: parts.day };
  };
}

/** 日历日期对应的 ISO 周（周一开始，含跨年：12 月底可能属于下一年第 1 周，1 月初可能属于上一年最后一周） */
function isoWeekKey({ year, month, day }: CalendarDate): string {
  // 以日历日期构造 UTC 日期，与夏令时无关
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  // 移到本周四：周四所在的年份即 ISO 周年
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${week}`;
}

/** 版本所在的抽样桶；null 表示全部保留 */
function bucketOf(
  createdAt: Date,
  now: Date,
  policy: VersionRetentionPolicy,
  calendar: (date: Date) => CalendarDate
): string | null {
  const age = now.getTime() - createdAt.getTime();
  if (age < policy.keepAllHours * HOUR_MS) return null;
  const date = calendar(createdAt);
  if (age < policy.dailyDays * DAY_MS) return `day:${date.year}-${date.month}-${date.day}`;
  if (age < policy.weeklyWeeks * 7 * DAY_MS) return `week:${isoWeekKey(date)}`;
  return `month:${date.year}-${date.month}`;
}

/**
 * 选出按策略应删除的版本 ID
 * 每个桶保留最新（版本号最大）的一个，最新版本本身也代表其所在的桶；
 * 创建时间无法解析或晚于当前时间（时钟回拨）的版本一律保留
 * @param timeZone 划分自然日/周/月的 IANA 时区，默认本机时区
 */
export function selectVersionsToPrune(
  versions: ReadonlyArray<RetentionCandidate>,
  policy: VersionRetentionPolicy,
  now: Date,
  timeZone?: string
): string[] {
  const calendar = calendarReader(timeZone);
  const sorted = [...versions].sort((a, b) => b.versionNumber - a.versionNumber);
  const keptBuckets = new Set<string>();
  const pruned: string[] = [];
  sorted.forEach((version, index) => {
    const createdAt = new Date(version.createdAt);
    if (Number.isNaN(createdAt.getTime())) return;
    const bucket = bucketOf(createdAt, now, policy, calendar);
    if (bucket === null) return;
    if (index > 0 && keptBuckets.has(bucket)) pruned.push(version.id);
    else keptBuckets.add(bucket);
  });
  return pruned;
}

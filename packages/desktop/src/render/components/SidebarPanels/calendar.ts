// ================================
// 日历：月网格、按日分组与日记标题
// 日期一律按本地时区计算
// ================================

import { displayTitle } from '../../lib/links/link-index';

/** 月网格固定 6 周 × 7 天，切换月份时高度不跳动 */
export const CALENDAR_CELLS = 42;

export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

/** 本地日期键 YYYY-MM-DD */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface CalendarDay {
  date: Date;
  key: string;
  /** 是否属于当前显示的月份 */
  inMonth: boolean;
}

/**
 * 某月的日历网格：一周从周一开始，首行包含上月末尾，不足 6 周用下月开头补齐
 * @param month 0-11
 */
export function buildMonthGrid(year: number, month: number): CalendarDay[] {
  // 本月 1 日之前需要补的上月天数（周一为 0）
  const leading = (new Date(year, month, 1).getDay() + 6) % 7;
  return Array.from({ length: CALENDAR_CELLS }, (_, index) => {
    const date = new Date(year, month, 1 - leading + index);
    return { date, key: dayKey(date), inMonth: date.getMonth() === month };
  });
}

/** 按本地日期分组，组内保持原顺序 */
export function groupByDay<T>(items: readonly T[], dateOf: (item: T) => Date): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = dayKey(dateOf(item));
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

const DIARY_PREFIX = '日记 ';
const DIARY_TITLE = /^日记 (\d{4}-\d{2}-\d{2})$/;

/** 某天的日记文件名（写作笔记，Markdown） */
export function diaryTitle(date: Date): string {
  return `${DIARY_PREFIX}${dayKey(date)}.md`;
}

/** 日记笔记对应的日期键；不是日记时返回 null */
export function diaryDayKey(title: string): string | null {
  return DIARY_TITLE.exec(displayTitle(title))?.[1] ?? null;
}

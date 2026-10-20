// ================================
// 日历：月历网格标记每天新建的条目数与日记，选中日期列出当日条目，
// 可切换月份、回到今天，并一键打开或创建所选日期的日记
// ================================

import React, { useCallback, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, NotebookPen } from 'lucide-react';
import type { KnowledgeItem } from '../../types/knowledge';
import { isWritingDocument } from '../../lib/documents/constants';
import { describeCreated } from './describe';
import { SidebarItemList } from './SidebarItemList';
import { buildMonthGrid, dayKey, diaryDayKey, groupByDay, WEEKDAY_LABELS } from './calendar';
import styles from './CalendarPanel.module.scss';

export interface CalendarPanelProps {
  items: KnowledgeItem[];
  selectedItemId?: string;
  onOpenItem: (id: string) => void;
  /** 打开已有日记（写作模式） */
  onOpenDiary: (id: string) => void;
  /** 创建某天的日记 */
  onCreateDiary: (date: Date) => void;
}

const NO_ITEMS: KnowledgeItem[] = [];

export const CalendarPanel: React.FC<CalendarPanelProps> = ({
  items,
  selectedItemId,
  onOpenItem,
  onOpenDiary,
  onCreateDiary,
}) => {
  const todayKey = dayKey(new Date());
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const selectedKey = dayKey(selectedDate);

  // 当天新建的条目（新的在前）与日记（按标题中的日期，而非创建时间）
  const createdByDay = useMemo(
    () =>
      groupByDay(
        [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        (item) => item.createdAt
      ),
    [items]
  );
  const diaryByDay = useMemo(() => {
    const diaries = new Map<string, KnowledgeItem>();
    for (const item of items) {
      if (!isWritingDocument(item)) continue;
      const key = diaryDayKey(item.title);
      if (key && !diaries.has(key)) diaries.set(key, item);
    }
    return diaries;
  }, [items]);

  const grid = useMemo(() => buildMonthGrid(month.year, month.month), [month]);
  const dayItems = createdByDay.get(selectedKey) ?? NO_ITEMS;
  const diary = diaryByDay.get(selectedKey);

  const shiftMonth = (delta: number) =>
    setMonth(({ year, month: m }) => {
      const date = new Date(year, m + delta, 1);
      return { year: date.getFullYear(), month: date.getMonth() };
    });

  const goToday = () => {
    const now = new Date();
    setMonth({ year: now.getFullYear(), month: now.getMonth() });
    setSelectedDate(now);
  };

  const selectDay = useCallback((date: Date) => {
    setSelectedDate(date);
    // 点到相邻月份的日期时跟随切换月份
    setMonth((current) =>
      current.year === date.getFullYear() && current.month === date.getMonth()
        ? current
        : { year: date.getFullYear(), month: date.getMonth() }
    );
  }, []);

  const isToday = selectedKey === todayKey;
  const dayLabel = isToday ? '今天' : `${selectedDate.getMonth() + 1} 月 ${selectedDate.getDate()} 日`;

  return (
    <div className={styles.panel}>
      <div className={styles.nav}>
        <button type="button" className={styles.navButton} onClick={() => shiftMonth(-1)} aria-label="上一月">
          <ChevronLeft size={14} />
        </button>
        <span className={styles.monthLabel} aria-live="polite">
          {month.year} 年 {month.month + 1} 月
        </span>
        <button type="button" className={styles.navButton} onClick={() => shiftMonth(1)} aria-label="下一月">
          <ChevronRight size={14} />
        </button>
        <button type="button" className={styles.todayButton} onClick={goToday}>
          今天
        </button>
      </div>

      <div className={styles.grid} role="grid" aria-label="日历">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className={styles.weekday} role="columnheader">
            {label}
          </div>
        ))}
        {grid.map((day) => {
          const count = createdByDay.get(day.key)?.length ?? 0;
          const hasDiary = diaryByDay.has(day.key);
          const classes = [
            styles.day,
            day.inMonth ? '' : styles.dayOutside,
            day.key === todayKey ? styles.dayToday : '',
            day.key === selectedKey ? styles.daySelected : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={day.key}
              type="button"
              role="gridcell"
              aria-selected={day.key === selectedKey}
              aria-label={`${day.date.getMonth() + 1} 月 ${day.date.getDate()} 日，新建 ${count} 个条目${hasDiary ? '，有日记' : ''}`}
              className={classes}
              onClick={() => selectDay(day.date)}
            >
              <span>{day.date.getDate()}</span>
              <span className={styles.marks} aria-hidden="true">
                {hasDiary && <span className={styles.diaryMark} />}
                {count > 0 && <span className={styles.count}>{count > 99 ? '99+' : count}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div className={styles.dayHeader}>
        <span className={styles.dayTitle}>
          {dayLabel} · 新建 {dayItems.length} 个条目
        </span>
        <button
          type="button"
          className={styles.diaryButton}
          onClick={() => (diary ? onOpenDiary(diary.id) : onCreateDiary(selectedDate))}
        >
          <NotebookPen size={12} />
          {diary ? '打开日记' : `写${isToday ? '今天的' : '这天的'}日记`}
        </button>
      </div>

      <SidebarItemList
        items={dayItems}
        selectedId={selectedItemId}
        onOpen={onOpenItem}
        describe={describeCreated}
        emptyText="这一天没有新建条目"
        ariaLabel={`${dayLabel}新建的条目`}
      />
    </div>
  );
};

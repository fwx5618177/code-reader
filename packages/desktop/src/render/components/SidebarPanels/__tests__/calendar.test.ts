import { describe, it, expect } from 'vitest';
import {
  buildMonthGrid,
  CALENDAR_CELLS,
  dayKey,
  diaryDayKey,
  diaryTitle,
  groupByDay,
} from '../calendar';

describe('dayKey', () => {
  it('按本地日期补零', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('buildMonthGrid', () => {
  it('固定 42 格，从周一开始，首行补上月末尾', () => {
    // 2026-10-01 是周四
    const grid = buildMonthGrid(2026, 9);
    expect(grid).toHaveLength(CALENDAR_CELLS);
    expect(grid[0].key).toBe('2026-09-28');
    expect(grid[0].date.getDay()).toBe(1);
    expect(grid[3]).toMatchObject({ key: '2026-10-01', inMonth: true });
    expect(grid.filter((day) => day.inMonth)).toHaveLength(31);
    expect(grid.at(-1)).toMatchObject({ key: '2026-11-08', inMonth: false });
  });

  it('1 日恰为周一时首格即 1 日；跨年月份正确', () => {
    // 2026-06-01 是周一
    expect(buildMonthGrid(2026, 5)[0].key).toBe('2026-06-01');
    const january = buildMonthGrid(2027, 0);
    expect(january[0].key).toBe('2026-12-28');
    expect(january.filter((day) => day.inMonth)).toHaveLength(31);
  });
});

describe('groupByDay', () => {
  it('按本地日期分组并保持原顺序', () => {
    const items = [
      { id: 'a', at: new Date(2026, 9, 17, 9) },
      { id: 'b', at: new Date(2026, 9, 16, 23) },
      { id: 'c', at: new Date(2026, 9, 17, 0, 1) },
    ];
    const groups = groupByDay(items, (item) => item.at);
    expect(groups.get('2026-10-17')?.map((item) => item.id)).toEqual(['a', 'c']);
    expect(groups.get('2026-10-16')?.map((item) => item.id)).toEqual(['b']);
    expect(groups.size).toBe(2);
  });
});

describe('日记标题', () => {
  it('生成与识别日记标题', () => {
    const date = new Date(2026, 9, 17);
    expect(diaryTitle(date)).toBe('日记 2026-10-17.md');
    expect(diaryDayKey(diaryTitle(date))).toBe('2026-10-17');
    expect(diaryDayKey('日记 2026-10-17')).toBe('2026-10-17');
    expect(diaryDayKey('周记 2026-10-17.md')).toBeNull();
    expect(diaryDayKey('日记 草稿.md')).toBeNull();
  });
});

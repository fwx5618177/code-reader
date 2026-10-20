// ================================
// 面板尺寸：上下限、读取校验与保存合并
// ================================

import { describe, expect, it } from 'vitest';
import {
  clampPanelSize,
  loadPanelSize,
  PANEL_SIZES_STORAGE_KEY,
  PANELS,
  savePanelSize,
  type PanelSizeSpec,
} from '../panel-sizes';

const spec: PanelSizeSpec = { id: 'test', defaultSize: 300, min: 200, max: 500 };

function memoryStorage(initial?: string): Storage {
  const data = new Map<string, string>(initial === undefined ? [] : [[PANEL_SIZES_STORAGE_KEY, initial]]);
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('clampPanelSize', () => {
  it('限制在上下限内，非有限数回到默认值', () => {
    expect(clampPanelSize(100, spec)).toBe(200);
    expect(clampPanelSize(900, spec)).toBe(500);
    expect(clampPanelSize(321.5, spec)).toBe(321.5);
    expect(clampPanelSize(Number.NaN, spec)).toBe(300);
    expect(clampPanelSize(Number.POSITIVE_INFINITY, spec)).toBe(300);
  });

  it('内置面板的默认值都在各自的上下限内', () => {
    for (const panel of Object.values(PANELS)) {
      expect(clampPanelSize(panel.defaultSize, panel), panel.id).toBe(panel.defaultSize);
    }
  });
});

describe('loadPanelSize / savePanelSize', () => {
  it('没有保存过、内容损坏或类型不对时使用默认值', () => {
    expect(loadPanelSize(spec, memoryStorage())).toBe(300);
    expect(loadPanelSize(spec, memoryStorage('{bad'))).toBe(300);
    expect(loadPanelSize(spec, memoryStorage('[1,2]'))).toBe(300);
    expect(loadPanelSize(spec, memoryStorage('{"test":"400"}'))).toBe(300);
  });

  it('读取时限制在上下限内（上限调整后旧值不越界）', () => {
    expect(loadPanelSize(spec, memoryStorage('{"test":420}'))).toBe(420);
    expect(loadPanelSize(spec, memoryStorage('{"test":9999}'))).toBe(500);
  });

  it('保存时保留其他面板的尺寸', () => {
    const storage = memoryStorage('{"other":123}');
    savePanelSize('test', 456, storage);
    expect(JSON.parse(storage.getItem(PANEL_SIZES_STORAGE_KEY)!)).toEqual({ other: 123, test: 456 });
    expect(loadPanelSize(spec, storage)).toBe(456);
  });
});

// ================================
// 可拖拽调整大小的面板：尺寸上下限与持久化
// 全部面板的尺寸保存在 localStorage 的单个键中（面板 ID → 尺寸），读取时校验并限制在上下限内
// ================================

export interface PanelSizeSpec {
  /** 持久化用的面板 ID */
  id: string;
  /** 默认尺寸（双击把手还原到此值） */
  defaultSize: number;
  min: number;
  max: number;
}

/** 应用中可调整大小的面板：宽度单位为像素，分栏编辑器为左栏所占百分比 */
export const PANELS = {
  sidebar: { id: 'sidebar', defaultSize: 280, min: 180, max: 480 },
  backlinks: { id: 'backlinks', defaultSize: 320, min: 240, max: 560 },
  inspector: { id: 'inspector', defaultSize: 360, min: 280, max: 640 },
  splitEditor: { id: 'split-editor', defaultSize: 50, min: 20, max: 80 },
} as const satisfies Record<string, PanelSizeSpec>;

export const PANEL_SIZES_STORAGE_KEY = 'panel-sizes';

/** 限制在上下限内；非有限数回到默认值 */
export function clampPanelSize(size: number, spec: PanelSizeSpec): number {
  if (!Number.isFinite(size)) return spec.defaultSize;
  return Math.min(spec.max, Math.max(spec.min, size));
}

function readPanelSizes(storage: Storage): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(storage.getItem(PANEL_SIZES_STORAGE_KEY) ?? '{}');
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function loadPanelSize(spec: PanelSizeSpec, storage: Storage = localStorage): number {
  const stored = readPanelSizes(storage)[spec.id];
  return typeof stored === 'number' ? clampPanelSize(stored, spec) : spec.defaultSize;
}

export function savePanelSize(id: string, size: number, storage: Storage = localStorage): void {
  storage.setItem(PANEL_SIZES_STORAGE_KEY, JSON.stringify({ ...readPanelSizes(storage), [id]: size }));
}

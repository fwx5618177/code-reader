// ================================
// 面板尺寸状态：读取已保存的尺寸，调整时限制在上下限内并自动保存
// ================================

import { useCallback, useEffect, useState } from 'react';
import { clampPanelSize, loadPanelSize, savePanelSize, type PanelSizeSpec } from '../lib/layout/panel-sizes';

export interface PanelSize {
  size: number;
  setSize: (size: number) => void;
  /** 还原为默认尺寸 */
  reset: () => void;
}

export function usePanelSize(spec: PanelSizeSpec): PanelSize {
  const [size, setSizeState] = useState(() => loadPanelSize(spec));

  useEffect(() => {
    savePanelSize(spec.id, size);
  }, [spec.id, size]);

  const setSize = useCallback((next: number) => setSizeState(clampPanelSize(next, spec)), [spec]);
  const reset = useCallback(() => setSizeState(spec.defaultSize), [spec]);

  return { size, setSize, reset };
}

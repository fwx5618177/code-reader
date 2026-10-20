// ================================
// 可拖拽调整宽度的侧面板
// 外层按保存的宽度布局，内容填满；把手贴在靠近主内容的一边（左侧栏在右边，右侧面板在左边）
// ================================

import React from 'react';
import { usePanelSize } from '../../hooks/usePanelSize';
import type { PanelSizeSpec } from '../../lib/layout/panel-sizes';
import { ResizeHandle } from './ResizeHandle';
import styles from './ResizablePanel.module.scss';

/** 方向键调整宽度的步长（像素） */
const KEYBOARD_STEP = 16;

export interface ResizablePanelProps {
  spec: PanelSizeSpec;
  /** 面板位于主内容的哪一侧 */
  side: 'left' | 'right';
  /** 把手的无障碍名称 */
  label: string;
  className?: string;
  children: React.ReactNode;
}

export const ResizablePanel: React.FC<ResizablePanelProps> = ({ spec, side, label, className, children }) => {
  const { size, setSize, reset } = usePanelSize(spec);
  const scale = side === 'left' ? 1 : -1;

  return (
    <div className={`${styles.panel} ${className ?? ''}`} style={{ width: size }}>
      {children}
      <ResizeHandle
        label={label}
        edge={side === 'left' ? 'right' : 'left'}
        value={size}
        min={spec.min}
        max={spec.max}
        pixelScale={() => scale}
        step={KEYBOARD_STEP}
        onChange={setSize}
        onReset={reset}
      />
    </div>
  );
};

export { ResizeHandle } from './ResizeHandle';
export default ResizablePanel;

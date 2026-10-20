// ================================
// 拖拽调整尺寸的把手（竖直分隔条）
// 贴在定位父元素的左边或右边：拖动、方向键（Shift 加大步长）、Home / End 调整，双击或回车还原
// ================================

import React, { useRef, useState } from 'react';
import styles from './ResizablePanel.module.scss';

export interface ResizeHandleProps {
  /** 无障碍名称，也用于悬停提示 */
  label: string;
  /** 把手贴在定位父元素的哪条边 */
  edge: 'left' | 'right';
  value: number;
  min: number;
  max: number;
  /** 指针右移 1px 时数值的变化量：面板在把手左侧为正、右侧为负；按百分比分栏时为 100 / 容器宽度 */
  pixelScale: () => number;
  /** 方向键每次调整的量 */
  step: number;
  onChange: (value: number) => void;
  /** 还原默认尺寸 */
  onReset: () => void;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  label,
  edge,
  value,
  min,
  max,
  pixelScale,
  step,
  onChange,
  onReset,
}) => {
  const drag = useRef<{ x: number; value: number; scale: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // 阻止默认行为：拖动时不选中文字、不把焦点交给编辑器
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, value, scale: pixelScale() };
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start) onChange(start.value + (event.clientX - start.x) * start.scale);
  };

  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // 方向键按把手移动的方向调整：面板在右侧时左移把手是变宽
    const delta = (event.shiftKey ? step * 4 : step) * Math.sign(pixelScale());
    switch (event.key) {
      case 'ArrowLeft':
        onChange(value - delta);
        break;
      case 'ArrowRight':
        onChange(value + delta);
        break;
      case 'Home':
        onChange(min);
        break;
      case 'End':
        onChange(max);
        break;
      case 'Enter':
        onReset();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label}：拖动调整，双击还原`}
      className={`${styles.handle} ${edge === 'left' ? styles.edgeLeft : styles.edgeRight} ${dragging ? styles.dragging : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    />
  );
};

export default ResizeHandle;

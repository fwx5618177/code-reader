// ================================
// 知识图谱画布
// GraphRenderer 的 React 包装：挂载时创建渲染器，属性变化时同步，卸载时销毁
// ================================

import React, { useEffect, useRef } from 'react';
import type { GraphData } from '../../lib/links';
import { GraphRenderer } from './graph-renderer';
import styles from './KnowledgeGraph.module.scss';

export interface GraphCanvasProps {
  data: GraphData;
  /** 焦点节点：绘制描边环，并初始居中 */
  focusId?: string;
  /** 搜索词：高亮标题匹配的节点 */
  highlightQuery?: string;
  onNodeClick: (id: string) => void;
  onNodeHover?: (id: string | null) => void;
}

const GraphCanvas: React.FC<GraphCanvasProps> = ({
  data,
  focusId,
  highlightQuery,
  onNodeClick,
  onNodeHover,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);
  // 回调通过 ref 读取最新值，避免回调变化时重建渲染器
  const callbacksRef = useRef({ onNodeClick, onNodeHover });
  callbacksRef.current = { onNodeClick, onNodeHover };

  useEffect(() => {
    const renderer = new GraphRenderer(hostRef.current!, canvasRef.current!, {
      onNodeClick: (id) => callbacksRef.current.onNodeClick(id),
      onNodeHover: (id) => callbacksRef.current.onNodeHover?.(id),
    });
    rendererRef.current = renderer;
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setData(data);
  }, [data]);

  useEffect(() => {
    rendererRef.current?.setFocus(focusId);
  }, [focusId]);

  useEffect(() => {
    rendererRef.current?.setHighlight(highlightQuery);
  }, [highlightQuery]);

  return (
    <div ref={hostRef} className={styles.canvasHost}>
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
};

export default GraphCanvas;

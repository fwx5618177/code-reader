// ================================
// 侧栏知识图谱：默认显示全局图谱并高亮当前选中条目，可切换为以选中条目为中心的局部图谱
// ================================

import React, { useState } from 'react';
import KnowledgeGraph, { type KnowledgeGraphMode } from '../KnowledgeGraph';
import type { LinkIndex, RelatedLink } from '../../lib/links/link-index';
import styles from './GraphPanel.module.scss';

export interface GraphPanelProps {
  index: LinkIndex;
  related: RelatedLink[];
  focusId?: string;
  onOpenItem: (id: string) => void;
  onCreateNote: (title: string) => void;
  onOpenSettings: () => void;
}

export const GraphPanel: React.FC<GraphPanelProps> = (props) => {
  const [mode, setMode] = useState<KnowledgeGraphMode>('global');
  return (
    <div className={styles.panel}>
      <KnowledgeGraph {...props} mode={mode} onModeChange={setMode} compact />
    </div>
  );
};

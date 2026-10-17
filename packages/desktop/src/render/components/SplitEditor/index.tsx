// ================================
// 分栏编辑区：一个或两个并排窗格，每个窗格有自己的标签栏与活动文档
//
// 同一文档在两个窗格中的一致性：编辑会话只有一个（见 useEditorTabs），只有聚焦窗格挂载可编辑的
// 编辑器（children）；非聚焦窗格显示其活动文档的只读预览，点击后成为聚焦窗格并接管编辑会话。
// 两个窗格打开同一文档时，预览直接渲染会话中的实时内容，因此另一窗格的输入会立即反映过来；
// 任何时刻只有一个写入方，两个窗格不会互相覆盖。
// ================================

import React, { useMemo } from 'react';
import EditorTabs from '../EditorTabs';
import PanePreview from './PanePreview';
import type { EditorTabsController } from '../../hooks/useEditorTabs';
import type { PaneIndex } from '../../lib/editor-tabs';
import type { Document, DocumentListItem } from '../../lib/documents';
import styles from './SplitEditor.module.scss';

export interface SplitEditorProps {
  tabs: EditorTabsController;
  documents: DocumentListItem[];
  /** 编辑会话中的文档（实时内容） */
  sessionDocument: Document | null;
  /** 聚焦窗格中的编辑器 */
  children: React.ReactNode;
}

export const SplitEditor: React.FC<SplitEditorProps> = ({
  tabs,
  documents,
  sessionDocument,
  children,
}) => {
  const updatedAt = useMemo(
    () => new Map(documents.map((doc) => [doc.id, doc.updatedAt.getTime()])),
    [documents]
  );

  return (
    <div className={styles.splitEditor}>
      {tabs.panes.map((group, index) => {
        const pane = index as PaneIndex;
        const focused = pane === tabs.focusedPane;
        return (
          <section key={pane} className={styles.pane}>
            <EditorTabs
              pane={pane}
              group={group}
              focused={focused}
              isSplit={tabs.isSplit}
              showActions={index === tabs.panes.length - 1}
              canReopen={tabs.canReopen}
              getTitle={tabs.getTitle}
              isDirty={tabs.isTabDirty}
              onActivate={tabs.activateTab}
              onClose={(from, docId) => void tabs.closeTab(from, docId)}
              onMove={tabs.moveTab}
              onToggleSplit={tabs.toggleSplit}
              onReopen={tabs.reopenClosedTab}
            />
            <div className={styles.paneBody}>
              {focused
                ? children
                : group.activeId && (
                    <PanePreview
                      docId={group.activeId}
                      sessionDocument={sessionDocument}
                      updatedAt={updatedAt.get(group.activeId)}
                      onActivate={() => tabs.focusPane(pane)}
                    />
                  )}
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default SplitEditor;

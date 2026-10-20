// ================================
// 分栏编辑区：一个或两个并排窗格，每个窗格有自己的标签栏、活动文档与编辑器
//
// 两栏同时可编辑：每栏的编辑器写入各自文档的托管实例（见 PaneEditor），同一文档在两栏打开时
// 共用一个实例并互相同步。在某一栏中按下鼠标或获得焦点即成为聚焦栏；聚焦栏决定当前文档，
// 底栏、版本历史、反向链接与插件命令都作用于它。
// 两栏之间的分隔条可以拖动调整左栏所占比例（双击还原为各占一半），比例保存后重启保持。
// ================================

import React, { useRef } from 'react';
import EditorTabs from '../EditorTabs';
import { ResizeHandle } from '../ResizablePanel';
import type { EditorTabsController } from '../../hooks/useEditorTabs';
import { usePanelSize } from '../../hooks/usePanelSize';
import type { PaneIndex, PaneView } from '../../lib/editor-tabs';
import { PANELS } from '../../lib/layout/panel-sizes';
import styles from './SplitEditor.module.scss';

/** 方向键调整分栏比例的步长（百分比） */
const KEYBOARD_STEP = 2;

export interface SplitEditorProps {
  tabs: EditorTabsController;
  /** 渲染窗格中活动文档的编辑器（按窗格的视图模式）；文档变化时重新创建 */
  renderPane: (docId: string, focused: boolean, view: PaneView) => React.ReactNode;
  /** 窗格中没有打开的文档时显示 */
  emptyPane: React.ReactNode;
}

export const SplitEditor: React.FC<SplitEditorProps> = ({ tabs, renderPane, emptyPane }) => {
  const container = useRef<HTMLDivElement>(null);
  const ratio = usePanelSize(PANELS.splitEditor);

  return (
    <div ref={container} className={styles.splitEditor}>
      {tabs.panes.map((group, index) => {
        const pane = index as PaneIndex;
        const focused = pane === tabs.focusedPane;
        const focusThisPane = focused ? undefined : () => tabs.focusPane(pane);
        const isLeftOfSplit = tabs.isSplit && index === 0;
        return (
          <section
            key={pane}
            className={styles.pane}
            style={isLeftOfSplit ? { flex: `0 0 ${ratio.size}%` } : undefined}
          >
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
            <div
              className={styles.paneBody}
              onMouseDownCapture={focusThisPane}
              onFocusCapture={focusThisPane}
            >
              {group.activeId ? (
                <React.Fragment key={group.activeId}>
                  {renderPane(group.activeId, focused, group.view)}
                </React.Fragment>
              ) : (
                emptyPane
              )}
            </div>
            {isLeftOfSplit && (
              <ResizeHandle
                label="调整分栏宽度"
                edge="right"
                value={ratio.size}
                min={PANELS.splitEditor.min}
                max={PANELS.splitEditor.max}
                pixelScale={() => 100 / (container.current?.clientWidth || 1)}
                step={KEYBOARD_STEP}
                onChange={ratio.setSize}
                onReset={ratio.reset}
              />
            )}
          </section>
        );
      })}
    </div>
  );
};

export default SplitEditor;

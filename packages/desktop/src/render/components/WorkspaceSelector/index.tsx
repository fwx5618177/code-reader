// ================================
// WorkspaceSelector 组件
// Ribbon 的工作区/模式选择器
// ================================

import React, { useState, useRef, useEffect } from 'react';
import {
  Brain,
  BookOpen,
  PenTool,
  Plus,
  Check,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { AppMode } from '../../types/app-modes';
import styles from './WorkspaceSelector.module.scss';

// ================================
// 类型定义
// ================================

export interface Workspace {
  id: string;
  type: AppMode;
  name: string;
  icon: React.ReactNode;
  color: string;
  shortcut?: string;
}

interface WorkspaceSelectorProps {
  /** 当前激活的工作区/模式 */
  currentMode: AppMode;
  /** 工作区变更回调 */
  onModeChange: (mode: AppMode) => void;
  /** 在新窗口打开工作区回调 */
  onOpenInNewWindow?: (mode: AppMode) => void;
  /** 选择器是否折叠（仅显示图标） */
  collapsed?: boolean;
}

// ================================
// 工作区定义
// ================================

const WORKSPACE_ICON_SIZE = 18;

const WORKSPACES: Workspace[] = [
  {
    id: 'reading',
    type: 'reading',
    name: '阅读',
    icon: <BookOpen size={WORKSPACE_ICON_SIZE} />,
    color: '#f59e0b', // 琥珀色
    shortcut: '⌘3',
  },
  {
    id: 'knowledge',
    type: 'knowledge',
    name: '知识库',
    icon: <Brain size={WORKSPACE_ICON_SIZE} />,
    color: '#10b981', // 绿色
    shortcut: '⌘1',
  },
  {
    id: 'writing',
    type: 'writing',
    name: '写作',
    icon: <PenTool size={WORKSPACE_ICON_SIZE} />,
    color: '#8b5cf6', // 紫色
    shortcut: '⌘2',
  },
];

// ================================
// WorkspaceSelector 组件
// ================================

const WorkspaceSelector: React.FC<WorkspaceSelectorProps> = ({
  currentMode,
  onModeChange,
  onOpenInNewWindow,
  collapsed = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const selectorRef = useRef<HTMLDivElement>(null);

  // 查找当前工作区
  const currentWorkspace = WORKSPACES.find((w) => w.type === currentMode) || WORKSPACES[0];

  // 点击外部时关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && isExpanded) {
        setIsExpanded(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded]);

  // 处理工作区选择
  const handleSelect = (workspace: Workspace, event: React.MouseEvent): void => {
    // Cmd/Ctrl + 点击在新窗口打开
    if (event.metaKey || event.ctrlKey) {
      onOpenInNewWindow?.(workspace.type);
      return;
    }

    onModeChange(workspace.type);
    setIsExpanded(false);
  };

  // 处理新窗口点击
  const handleNewWindow = (workspace: Workspace, event: React.MouseEvent): void => {
    event.stopPropagation();
    onOpenInNewWindow?.(workspace.type);
  };

  // 构建容器类名
  const containerClassName = [
    styles.workspaceSelector,
    collapsed ? styles.collapsed : '',
    isExpanded ? styles.expanded : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={selectorRef} className={containerClassName}>
      {/* 当前工作区按钮 */}
      <button
        className={styles.workspaceCurrent}
        onClick={() => setIsExpanded(!isExpanded)}
        title={`${currentWorkspace.name} (点击切换工作区)`}
        style={{ '--workspace-color': currentWorkspace.color } as React.CSSProperties}
      >
        <span className={styles.workspaceIcon}>{currentWorkspace.icon}</span>
        {!collapsed && (
          <>
            <span className={styles.workspaceName}>{currentWorkspace.name}</span>
            <ChevronRight
              size={12}
              className={`${styles.workspaceChevron} ${isExpanded ? styles.workspaceChevronRotated : ''}`}
            />
          </>
        )}
      </button>

      {/* 工作区下拉列表 */}
      {isExpanded && (
        <div className={styles.workspaceDropdown}>
          <div className={styles.workspaceDropdownHeader}>
            <span>切换工作区</span>
          </div>

          <div className={styles.workspaceList}>
            {WORKSPACES.map((workspace) => (
              <button
                key={workspace.id}
                className={`${styles.workspaceItem} ${currentMode === workspace.type ? styles.workspaceItemActive : ''}`}
                onClick={(e) => handleSelect(workspace, e)}
                onMouseEnter={() => setHoveredId(workspace.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{ '--workspace-color': workspace.color } as React.CSSProperties}
                title={`${workspace.name} (${workspace.shortcut})\n⌘+点击在新窗口打开`}
              >
                <span className={styles.workspaceItemIcon}>{workspace.icon}</span>
                <span className={styles.workspaceItemName}>{workspace.name}</span>

                <div className={styles.workspaceItemMeta}>
                  {workspace.shortcut && (
                    <kbd className={styles.workspaceShortcut}>{workspace.shortcut}</kbd>
                  )}

                  {currentMode === workspace.type && (
                    <Check size={14} className={styles.workspaceCheck} />
                  )}

                  {hoveredId === workspace.id && onOpenInNewWindow && (
                    <button
                      className={styles.workspaceNewWindow}
                      onClick={(e) => handleNewWindow(workspace, e)}
                      title="在新窗口打开"
                    >
                      <ExternalLink size={12} />
                    </button>
                  )}
                </div>
              </button>
            ))}
          </div>

          <div className={styles.workspaceDropdownFooter}>
            <button className={styles.workspaceAdd} title="创建新工作区">
              <Plus size={14} />
              <span>新建工作区</span>
            </button>
          </div>
        </div>
      )}

      {/* 快速访问图标（未展开时显示） */}
      {!collapsed && !isExpanded && (
        <div className={styles.workspaceQuickAccess}>
          {WORKSPACES.filter((w) => w.type !== currentMode)
            .slice(0, 3)
            .map((workspace) => (
              <button
                key={workspace.id}
                className={styles.workspaceQuickBtn}
                onClick={(e) => handleSelect(workspace, e)}
                title={`${workspace.name} (${workspace.shortcut})`}
                style={{ '--workspace-color': workspace.color } as React.CSSProperties}
              >
                {React.cloneElement(workspace.icon as React.ReactElement, { size: 14 })}
              </button>
            ))}
        </div>
      )}
    </div>
  );
};

export default WorkspaceSelector;

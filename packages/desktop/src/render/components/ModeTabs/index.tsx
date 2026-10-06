// ================================
// ModeTabs 组件
// 用于切换不同模式的标签页头部
// 支持在新窗口中打开模式
// ================================

import React, { useState, useCallback } from 'react';
import { Brain, BookOpen, PenTool, Plus, ExternalLink } from 'lucide-react';
import { AppMode } from '../../types/app-modes';
import styles from './ModeTabs.module.scss';

// ================================
// 类型定义
// ================================

interface ModeTab {
  mode: AppMode;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
}

interface ModeTabsProps {
  /** 当前激活的模式 */
  currentMode: AppMode;
  /** 模式变更回调 */
  onModeChange: (mode: AppMode) => void;
  /** 是否显示新窗口按钮 */
  showNewWindow?: boolean;
  /** 紧凑模式（仅显示图标） */
  compact?: boolean;
}

// ================================
// 模式定义
// ================================

const MODE_TABS: ModeTab[] = [
  {
    mode: 'reading',
    label: '阅读',
    icon: <BookOpen size={14} />,
    shortcut: '⌘3',
  },
  {
    mode: 'knowledge',
    label: '知识库',
    icon: <Brain size={14} />,
    shortcut: '⌘1',
  },
  {
    mode: 'writing',
    label: '写作',
    icon: <PenTool size={14} />,
    shortcut: '⌘2',
  },
];

// ================================
// 组件实现
// ================================

const ModeTabs: React.FC<ModeTabsProps> = ({
  currentMode,
  onModeChange,
  showNewWindow = true,
  compact = false,
}) => {
  const [hoveredMode, setHoveredMode] = useState<AppMode | null>(null);
  const [isCreatingWindow, setIsCreatingWindow] = useState(false);

  // 处理标签页点击
  const handleTabClick = useCallback(
    (mode: AppMode, event: React.MouseEvent) => {
      // 中键点击或 Cmd/Ctrl+点击 在新窗口打开
      if (event.button === 1 || event.metaKey || event.ctrlKey) {
        handleOpenInNewWindow(mode);
        return;
      }

      onModeChange(mode);
    },
    [onModeChange]
  );

  // 处理在新窗口打开模式
  const handleOpenInNewWindow = useCallback(
    async (mode: AppMode) => {
      if (isCreatingWindow) return;

      try {
        setIsCreatingWindow(true);
        await window.electron.window.createChild(mode);
      } catch (error) {
        console.error('创建新窗口失败:', error);
      } finally {
        setIsCreatingWindow(false);
      }
    },
    [isCreatingWindow]
  );

  // 处理右键菜单
  const handleContextMenu = useCallback(
    (mode: AppMode, event: React.MouseEvent) => {
      event.preventDefault();
      // 可以在这里显示上下文菜单
      handleOpenInNewWindow(mode);
    },
    [handleOpenInNewWindow]
  );

  // 组合容器类名
  const containerClassName = [styles.modeTabs, compact ? styles.compact : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClassName}>
      <div className={styles.modeTabsList}>
        {MODE_TABS.map((tab) => {
          // 组合标签页类名
          const tabClassName = [styles.modeTab, currentMode === tab.mode ? styles.active : '']
            .filter(Boolean)
            .join(' ');

          return (
            <button
              key={tab.mode}
              className={tabClassName}
              onClick={(e) => handleTabClick(tab.mode, e)}
              onMouseDown={(e) => {
                // 处理中键点击
                if (e.button === 1) {
                  e.preventDefault();
                  handleOpenInNewWindow(tab.mode);
                }
              }}
              onContextMenu={(e) => handleContextMenu(tab.mode, e)}
              onMouseEnter={() => setHoveredMode(tab.mode)}
              onMouseLeave={() => setHoveredMode(null)}
              title={`${tab.label} (${tab.shortcut})${showNewWindow ? '\n⌘+点击或中键在新窗口打开' : ''}`}
            >
              <span className={styles.modeTabIcon}>{tab.icon}</span>
              {!compact && <span className={styles.modeTabLabel}>{tab.label}</span>}

              {/* 悬停时显示新窗口按钮 */}
              {showNewWindow && hoveredMode === tab.mode && currentMode !== tab.mode && (
                <span
                  className={styles.modeTabNewWindow}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenInNewWindow(tab.mode);
                  }}
                  title="在新窗口打开"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      handleOpenInNewWindow(tab.mode);
                    }
                  }}
                >
                  <ExternalLink size={10} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 新窗口按钮 */}
      {showNewWindow && (
        <button
          className={styles.modeTabsNewWindow}
          onClick={() => handleOpenInNewWindow(currentMode)}
          disabled={isCreatingWindow}
          title="在新窗口打开当前模式"
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
};

export default ModeTabs;

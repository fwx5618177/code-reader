// ================================
// TitleBar 组件
// 标题栏，包含模式标签、专注模式按钮和窗口控制
// ================================

import React, { useEffect, useState } from 'react';
import {
  Minus,
  Square,
  X,
  Copy,
  Search,
  Code2,
  BookOpen,
  Brain,
  PenTool,
  Focus,
} from 'lucide-react';
import { AppMode, APP_MODE_CONFIGS } from '../../types/app-modes';
import Tooltip from '../Tooltip';
import styles from './TitleBar.module.scss';

// ================================
// 类型定义
// ================================

interface TitleBarProps {
  /** 窗口标题 */
  title?: string;
  /** 副标题（如文件夹名） */
  subtitle?: string;
  /** 打开搜索的回调 */
  onOpenSearch?: () => void;
  /** 当前应用模式 */
  currentMode?: AppMode;
  /** 模式变更时的回调 */
  onModeChange?: (mode: AppMode) => void;
  /** 进入专注模式的回调 */
  onEnterFocusMode?: () => void;
  /** 是否处于专注模式 */
  isInFocusMode?: boolean;
}

// ================================
// 模式标签配置
// ================================

interface ModeTabConfig {
  mode: AppMode;
  label: string;
  icon: React.ReactNode;
  shortcut: string;
}

const MODE_TABS: ModeTabConfig[] = [
  {
    mode: 'code-reader',
    label: '代码',
    icon: <Code2 size={14} />,
    shortcut: '⌘1',
  },
  {
    mode: 'reading',
    label: '阅读',
    icon: <BookOpen size={14} />,
    shortcut: '⌘2',
  },
  {
    mode: 'knowledge',
    label: '知识库',
    icon: <Brain size={14} />,
    shortcut: '⌘3',
  },
  {
    mode: 'writing',
    label: '写作',
    icon: <PenTool size={14} />,
    shortcut: '⌘4',
  },
];

// ================================
// TitleBar 组件
// ================================

const TitleBar: React.FC<TitleBarProps> = ({
  title = 'Code Reader',
  subtitle,
  onOpenSearch,
  currentMode = 'code-reader',
  onModeChange,
  onEnterFocusMode,
  isInFocusMode = false,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFocused, setIsFocused] = useState(true);
  const platform = window.electron?.platform || 'darwin';
  const isMac = platform === 'darwin';

  // 检查窗口是否最大化
  useEffect(() => {
    const checkMaximized = async () => {
      try {
        const maximized = await window.electron?.window?.isMaximized();
        setIsMaximized(maximized || false);
      } catch (e) {
        console.error('检查最大化状态失败:', e);
      }
    };

    checkMaximized();

    // 监听窗口焦点/失焦
    const handleFocus = () => setIsFocused(true);
    const handleBlur = () => setIsFocused(false);

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // 窗口控制
  const handleMinimize = () => {
    window.electron?.window?.minimize();
  };

  const handleMaximize = async () => {
    await window.electron?.window?.maximize();
    const maximized = await window.electron?.window?.isMaximized();
    setIsMaximized(maximized || false);
  };

  const handleClose = () => {
    window.electron?.window?.close();
  };

  // 处理模式标签点击
  const handleModeClick = (mode: AppMode) => {
    onModeChange?.(mode);
  };

  // 构建标题栏类名
  const titlebarClasses = [
    styles.titlebar,
    isFocused ? styles.focused : styles.blurred,
    isMac ? styles.mac : styles.windows,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <header className={titlebarClasses}>
      {/* macOS 红绿灯占位区域 */}
      {isMac && <div className={styles.trafficLights} />}

      {/* 左侧区域 - 搜索 */}
      <div className={styles.left}>
        {onOpenSearch && (
          <Tooltip content="搜索" shortcut="⌘P" position="bottom">
            <button className={`${styles.button} ${styles.searchBtn}`} onClick={onOpenSearch}>
              <Search size={14} />
            </button>
          </Tooltip>
        )}
      </div>

      {/* 中间区域 - 模式标签（可拖拽区域） */}
      <div className={`${styles.center} app-drag`}>
        {onModeChange ? (
          <div className={`${styles.tabs} app-no-drag`}>
            {MODE_TABS.map((tab) => (
              <Tooltip
                key={tab.mode}
                content={APP_MODE_CONFIGS[tab.mode].nameCN}
                shortcut={tab.shortcut}
                position="bottom"
                delay={400}
              >
                <button
                  className={`${styles.tab} ${currentMode === tab.mode ? styles.active : ''}`}
                  onClick={() => handleModeClick(tab.mode)}
                >
                  <span className={styles.tabIcon}>{tab.icon}</span>
                  <span className={styles.tabLabel}>{tab.label}</span>
                </button>
              </Tooltip>
            ))}
          </div>
        ) : (
          <div className={styles.titleGroup}>
            <span className={styles.title}>{title}</span>
            {subtitle && (
              <>
                <span className={styles.separator}>—</span>
                <span className={styles.subtitle}>{subtitle}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* 右侧区域 - 专注模式、副标题和窗口控制 */}
      <div className={styles.right}>
        {/* 专注模式按钮 */}
        {onEnterFocusMode && currentMode === 'writing' && !isInFocusMode && (
          <Tooltip content="专注模式" shortcut="⌘⇧F" position="bottom">
            <button
              className={`${styles.button} ${styles.focusBtn}`}
              onClick={onEnterFocusMode}
              aria-label="进入专注模式"
            >
              <Focus size={14} />
            </button>
          </Tooltip>
        )}

        {/* 副标题徽章 */}
        {subtitle && <span className={styles.subtitleBadge}>{subtitle}</span>}

        {/* Windows 窗口控制按钮 */}
        {!isMac && (
          <div className={styles.windowControls}>
            <button className={styles.windowControl} onClick={handleMinimize} title="最小化">
              <Minus size={12} />
            </button>
            <button
              className={styles.windowControl}
              onClick={handleMaximize}
              title={isMaximized ? '还原' : '最大化'}
            >
              {isMaximized ? <Copy size={10} /> : <Square size={10} />}
            </button>
            <button
              className={`${styles.windowControl} ${styles.close}`}
              onClick={handleClose}
              title="关闭"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default TitleBar;

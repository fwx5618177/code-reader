// ================================
// Layout 组件
// 主应用布局，包含 Ribbon、侧边栏和内容区域
// 使用 CSS Modules 实现样式
// ================================

import React, { useState } from 'react';
import TitleBar from '../TitleBar';
import Ribbon from '../Ribbon';
import { AppMode } from '../../types/app-modes';
import styles from './Layout.module.scss';

// ================================
// 类型定义
// ================================

interface LayoutProps {
  /** 主内容 */
  children: React.ReactNode;
  /** 打开本地文件夹回调 */
  onOpenLocal: () => void;
  /** 当前文件夹路径 */
  folderPath: string | null;
  /** 打开快速输入回调 */
  onQuickInput?: () => void;
  /** 开始录音回调 */
  onStartRecording?: () => void;
  /** 当前应用模式 */
  currentMode?: AppMode;
  /** 模式变更回调 */
  onModeChange?: (mode: AppMode) => void;
  /** 打开搜索回调 */
  onOpenSearch?: () => void;
  /** 打开设置回调 */
  onOpenSettings?: () => void;
  /** 进入专注模式回调 */
  onEnterFocusMode?: () => void;
  /** 是否处于专注模式 */
  isInFocusMode?: boolean;
}

// 模式显示名称
const MODE_DISPLAY_NAMES: Record<AppMode, string> = {
  'code-reader': '代码阅读',
  reading: '阅读',
  knowledge: '知识库',
  writing: '写作',
};

// ================================
// Layout 组件
// ================================

const Layout: React.FC<LayoutProps> = ({
  children,
  onOpenLocal,
  folderPath,
  onQuickInput,
  onStartRecording,
  currentMode = 'code-reader',
  onModeChange,
  onOpenSearch,
  onOpenSettings,
  onEnterFocusMode,
  isInFocusMode = false,
}) => {
  const [activePanel, setActivePanel] = useState('files');
  const [sidebarVisible, setSidebarVisible] = useState(true);

  // 处理面板切换
  const handlePanelChange = (panel: string) => {
    if (panel === activePanel && sidebarVisible) {
      setSidebarVisible(false);
    } else {
      setActivePanel(panel);
      setSidebarVisible(true);
    }
  };

  // 处理模式变更
  const handleModeChange = (mode: AppMode) => {
    onModeChange?.(mode);
  };

  // 获取当前文件夹名称作为副标题
  const folderName = folderPath ? folderPath.split('/').pop() : undefined;

  // 获取模式显示名称
  const getModeDisplayName = (): string => {
    return MODE_DISPLAY_NAMES[currentMode] || '';
  };

  // 获取模式 Emoji
  const getModeEmoji = (): string => {
    switch (currentMode) {
      case 'code-reader':
        return '💻';
      case 'reading':
        return '📖';
      case 'knowledge':
        return '🧠';
      case 'writing':
        return '✍️';
      default:
        return '';
    }
  };

  // 获取平台类名
  const platform = window.electron?.platform || 'darwin';

  return (
    <div className={styles.layout} data-platform={platform} data-mode={currentMode}>
      {/* 标题栏 */}
      <TitleBar
        title="Code Reader"
        subtitle={folderName}
        onOpenSearch={onOpenSearch}
        currentMode={currentMode}
        onModeChange={handleModeChange}
        onEnterFocusMode={onEnterFocusMode}
        isInFocusMode={isInFocusMode}
      />

      {/* 主容器 */}
      <div className={styles.mainContainer}>
        {/* Ribbon - 左侧导航栏 */}
        <Ribbon
          activePanel={activePanel}
          onPanelChange={handlePanelChange}
          onQuickNote={onQuickInput}
          onStartRecording={onStartRecording}
          onOpenFolder={onOpenLocal}
          currentMode={currentMode}
          onOpenSettings={onOpenSettings}
          onOpenSearch={onOpenSearch}
        />

        {/* 内容区域 */}
        <div className={styles.contentWrapper}>{children}</div>
      </div>

      {/* 状态栏 */}
      <div className={styles.statusbar}>
        <div className={styles.statusbarLeft}>
          {folderPath && <span className={styles.statusbarItem}>📁 {folderPath}</span>}
          {currentMode !== 'code-reader' && (
            <span className={`${styles.statusbarItem} ${styles.modeIndicator}`}>
              {getModeEmoji()} {getModeDisplayName()}
            </span>
          )}
        </div>
        <div className={styles.statusbarRight}>
          <span className={styles.statusbarItem}>就绪</span>
        </div>
      </div>
    </div>
  );
};

export default Layout;

// ================================
// Layout 组件
// 主应用布局，包含 Ribbon、侧边栏和内容区域
// 使用 CSS Modules 实现样式
// ================================

import React from 'react';
import TitleBar from '../TitleBar';
import Ribbon from '../Ribbon';
import PluginStatusBar from '../PluginHost/PluginStatusBar';
import { AppMode, SidebarPanel } from '../../types/app-modes';
import styles from './Layout.module.scss';

// ================================
// 类型定义
// ================================

interface LayoutProps {
  /** 主内容 */
  children: React.ReactNode;
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
  /** 当前活动侧栏面板（侧栏折叠时为 null） */
  activePanel: SidebarPanel | null;
  /** 点击 Ribbon 导航按钮 */
  onPanelChange: (panel: SidebarPanel) => void;
}

// 模式显示名称
const MODE_DISPLAY_NAMES: Record<AppMode, string> = {
  reading: '阅读',
  knowledge: '知识库',
  writing: '写作',
};

// ================================
// Layout 组件
// ================================

const Layout: React.FC<LayoutProps> = ({
  children,
  onQuickInput,
  onStartRecording,
  currentMode = 'knowledge',
  onModeChange,
  onOpenSearch,
  onOpenSettings,
  onEnterFocusMode,
  isInFocusMode = false,
  activePanel,
  onPanelChange,
}) => {
  // 处理模式变更
  const handleModeChange = (mode: AppMode) => {
    onModeChange?.(mode);
  };

  // 获取模式显示名称
  const getModeDisplayName = (): string => {
    return MODE_DISPLAY_NAMES[currentMode] || '';
  };

  // 获取模式 Emoji
  const getModeEmoji = (): string => {
    switch (currentMode) {
      case 'reading':
        return '📖';
      case 'knowledge':
        return '🧠';
      case 'writing':
        return '✍️';
    }
  };

  // 获取平台类名
  const platform = window.electron?.platform || 'darwin';

  return (
    <div className={styles.layout} data-platform={platform} data-mode={currentMode}>
      {/* 标题栏 */}
      <TitleBar
        title="Code Reader"
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
          onPanelChange={onPanelChange}
          onQuickNote={onQuickInput}
          onStartRecording={onStartRecording}
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
          <span className={`${styles.statusbarItem} ${styles.modeIndicator}`}>
            {getModeEmoji()} {getModeDisplayName()}
          </span>
        </div>
        <div className={styles.statusbarRight}>
          <PluginStatusBar />
          <span className={styles.statusbarItem}>就绪</span>
        </div>
      </div>
    </div>
  );
};

export default Layout;

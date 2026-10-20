// ================================
// Layout 组件
// 主应用布局，包含 Ribbon、侧边栏和内容区域
// 使用 CSS Modules 实现样式
// ================================

import React from 'react';
import { BookOpen, Brain, PenTool } from 'lucide-react';
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
  /** 打开使用指南 */
  onOpenGuide?: () => void;
  /** 进入专注模式回调 */
  onEnterFocusMode?: () => void;
  /** 是否处于专注模式 */
  isInFocusMode?: boolean;
  /** 当前活动侧栏面板（侧栏折叠时为 null） */
  activePanel: SidebarPanel | null;
  /** 点击 Ribbon 导航按钮 */
  onPanelChange: (panel: SidebarPanel) => void;
  /** 状态栏中段：当前页面的状态（如写作页的字数、保存状态与视图切换） */
  statusContent?: React.ReactNode;
}

// 状态栏的模式指示：图标与标题栏的模式切换一致
const MODE_STATUS: Record<AppMode, { label: string; icon: React.ReactNode }> = {
  knowledge: { label: '知识库', icon: <Brain size={12} /> },
  writing: { label: '写作', icon: <PenTool size={12} /> },
  reading: { label: '阅读', icon: <BookOpen size={12} /> },
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
  onOpenGuide,
  onEnterFocusMode,
  isInFocusMode = false,
  activePanel,
  onPanelChange,
  statusContent,
}) => {
  // 处理模式变更
  const handleModeChange = (mode: AppMode) => {
    onModeChange?.(mode);
  };

  return (
    <div className={styles.layout}>
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
          onOpenGuide={onOpenGuide}
          onOpenSearch={onOpenSearch}
        />

        {/* 内容区域 */}
        <div className={styles.contentWrapper}>{children}</div>
      </div>

      {/* 状态栏 */}
      <footer className={styles.statusbar}>
        <span className={styles.modeIndicator}>
          {MODE_STATUS[currentMode].icon}
          {MODE_STATUS[currentMode].label}
        </span>
        <div className={styles.statusbarContent}>{statusContent}</div>
        <div className={styles.statusbarRight}>
          <PluginStatusBar />
        </div>
      </footer>
    </div>
  );
};

export default Layout;

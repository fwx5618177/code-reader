// ================================
// Ribbon Component
// Compact icon-based left sidebar with navigation and quick actions
// Mode switching is handled by TitleBar
// ================================

import React from 'react';
import {
  Files,
  Tag,
  Settings,
  PlusCircle,
  Mic,
  Calendar,
  Network,
  Search,
  Clock,
  List,
  Bookmark,
  BookMarked,
  Link2,
} from 'lucide-react';
import { AppMode, MODE_SIDEBAR_PANELS, SidebarPanel } from '../../types/app-modes';
import Tooltip from '../Tooltip';
import styles from './Ribbon.module.scss';

// ================================
// 类型定义
// ================================

interface RibbonProps {
  activePanel: SidebarPanel | null;
  onPanelChange: (panel: SidebarPanel) => void;
  onQuickNote?: () => void;
  onStartRecording?: () => void;
  currentMode?: AppMode;
  onOpenSettings?: () => void;
  onOpenSearch?: () => void;
}

interface RibbonButtonProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  isActive?: boolean;
  onClick: () => void;
  badge?: string | number;
  disabled?: boolean;
  className?: string;
}

// ================================
// RibbonButton 组件（带 Tooltip）
// ================================

const RibbonButton: React.FC<RibbonButtonProps> = ({
  icon,
  label,
  shortcut,
  isActive,
  onClick,
  badge,
  disabled,
  className = '',
}) => {
  const buttonClasses = [
    styles.button,
    isActive ? styles.active : '',
    disabled ? styles.disabled : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tooltip content={label} shortcut={shortcut} position="right" delay={300}>
      <button className={buttonClasses} onClick={onClick} disabled={disabled} aria-label={label}>
        {icon}
        {badge !== undefined && <span className={styles.badge}>{badge}</span>}
      </button>
    </Tooltip>
  );
};

// ================================
// 导航按钮图标（面板列表与文案见 MODE_SIDEBAR_PANELS）
// ================================

const PANEL_ICONS: Record<SidebarPanel, React.ReactNode> = {
  chapters: <BookMarked size={20} />,
  bookmarks: <Bookmark size={20} />,
  files: <Files size={20} />,
  search: <Search size={20} />,
  recent: <Clock size={20} />,
  tags: <Tag size={20} />,
  recordings: <Mic size={20} />,
  graph: <Network size={20} />,
  calendar: <Calendar size={20} />,
  outline: <List size={20} />,
  references: <Link2 size={20} />,
};

// ================================
// Ribbon 组件
// ================================

const Ribbon: React.FC<RibbonProps> = ({
  activePanel,
  onPanelChange,
  onQuickNote,
  onStartRecording,
  currentMode = 'knowledge',
  onOpenSettings,
}) => {
  const navigationButtons = MODE_SIDEBAR_PANELS[currentMode];

  return (
    <div className={styles.ribbon}>
      {/* 顶部区域 - 快捷操作和导航 */}
      <div className={styles.top}>
        {/* 快捷操作 */}
        <div className={styles.section}>
          <RibbonButton
            icon={<PlusCircle size={20} />}
            label="快速笔记"
            shortcut="⌘N"
            onClick={onQuickNote || (() => {})}
          />
          {currentMode === 'knowledge' && (
            <RibbonButton
              icon={<Mic size={20} />}
              label="快速录音"
              shortcut="⌘⇧R"
              onClick={onStartRecording || (() => {})}
            />
          )}
        </div>

        <div className={styles.divider} />

        {/* 导航 */}
        <div className={styles.section}>
          {navigationButtons.map((button) => (
            <RibbonButton
              key={button.id}
              icon={PANEL_ICONS[button.id]}
              label={button.label}
              isActive={activePanel === button.id}
              onClick={() => onPanelChange(button.id)}
            />
          ))}
        </div>
      </div>

      {/* 底部区域 - 设置 */}
      <div className={styles.bottom}>
        <RibbonButton
          icon={<Settings size={20} />}
          label="设置"
          shortcut="⌘,"
          onClick={() => onOpenSettings?.()}
        />
      </div>
    </div>
  );
};

export default Ribbon;

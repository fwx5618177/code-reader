// ================================
// Ribbon Component
// Compact icon-based left sidebar with navigation and quick actions
// Mode switching is handled by TitleBar
// ================================

import React from 'react';
import {
  Files,
  GitBranch,
  Tag,
  Settings,
  PlusCircle,
  Mic,
  Calendar,
  FolderOpen,
  Network,
  Search,
  Clock,
  List,
  Bookmark,
  BookMarked,
  Link2,
} from 'lucide-react';
import { AppMode } from '../../types/app-modes';
import Tooltip from '../Tooltip';
import styles from './Ribbon.module.scss';

// ================================
// 类型定义
// ================================

interface RibbonProps {
  activePanel: string;
  onPanelChange: (panel: string) => void;
  onQuickNote?: () => void;
  onStartRecording?: () => void;
  onOpenFolder?: () => void;
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
      <button className={buttonClasses} onClick={onClick} disabled={disabled}>
        {icon}
        {badge !== undefined && <span className={styles.badge}>{badge}</span>}
      </button>
    </Tooltip>
  );
};

// ================================
// 导航按钮定义
// ================================

interface NavButton {
  id: string;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
}

const getNavigationButtons = (mode: AppMode): NavButton[] => {
  switch (mode) {
    case 'code-reader':
      return [
        { id: 'files', icon: <Files size={20} />, label: '文件' },
        { id: 'search', icon: <Search size={20} />, label: '搜索', shortcut: '⌘⇧F' },
        { id: 'git', icon: <GitBranch size={20} />, label: 'Git' },
        { id: 'outline', icon: <List size={20} />, label: '大纲' },
        { id: 'bookmarks', icon: <Bookmark size={20} />, label: '书签' },
      ];
    case 'reading':
      return [
        { id: 'chapters', icon: <BookMarked size={20} />, label: '章节' },
        { id: 'bookmarks', icon: <Bookmark size={20} />, label: '书签' },
        { id: 'files', icon: <Files size={20} />, label: '书库' },
        { id: 'search', icon: <Search size={20} />, label: '搜索' },
        { id: 'recent', icon: <Clock size={20} />, label: '最近阅读' },
      ];
    case 'knowledge':
      return [
        { id: 'files', icon: <Files size={20} />, label: '文件夹' },
        { id: 'search', icon: <Search size={20} />, label: '搜索', shortcut: '⌘⇧F' },
        { id: 'tags', icon: <Tag size={20} />, label: '标签' },
        { id: 'recordings', icon: <Mic size={20} />, label: '录音' },
        { id: 'graph', icon: <Network size={20} />, label: '知识图谱' },
        { id: 'calendar', icon: <Calendar size={20} />, label: '日历' },
        { id: 'recent', icon: <Clock size={20} />, label: '最近' },
      ];
    case 'writing':
      return [
        { id: 'outline', icon: <List size={20} />, label: '大纲' },
        { id: 'files', icon: <Files size={20} />, label: '文件' },
        { id: 'references', icon: <Link2 size={20} />, label: '参考' },
        { id: 'tags', icon: <Tag size={20} />, label: '标签' },
        { id: 'recent', icon: <Clock size={20} />, label: '最近' },
      ];
    default:
      return [{ id: 'files', icon: <Files size={20} />, label: '文件' }];
  }
};

// ================================
// Ribbon 组件
// ================================

const Ribbon: React.FC<RibbonProps> = ({
  activePanel,
  onPanelChange,
  onQuickNote,
  onStartRecording,
  onOpenFolder,
  currentMode = 'code-reader',
  onOpenSettings,
}) => {
  const navigationButtons = getNavigationButtons(currentMode);

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
          {currentMode === 'code-reader' && onOpenFolder && (
            <RibbonButton
              icon={<FolderOpen size={20} />}
              label="打开文件夹"
              shortcut="⌘O"
              onClick={onOpenFolder}
            />
          )}
        </div>

        <div className={styles.divider} />

        {/* 导航 */}
        <div className={styles.section}>
          {navigationButtons.map((button) => (
            <RibbonButton
              key={button.id}
              icon={button.icon}
              label={button.label}
              shortcut={button.shortcut}
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

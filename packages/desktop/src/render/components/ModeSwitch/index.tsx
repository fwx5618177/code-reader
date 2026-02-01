// ================================
// ModeSwitch 组件
// 在不同应用模式之间切换
// ================================

import React, { useState, useRef, useEffect } from 'react';
import { Code2, Brain, BookOpen, PenTool, ChevronDown, Check, Keyboard } from 'lucide-react';
import { AppMode, APP_MODE_CONFIGS } from '../../types/app-modes';
import styles from './ModeSwitch.module.scss';

// ================================
// 类型定义
// ================================

interface ModeSwitchProps {
  currentMode: AppMode;
  onModeChange: (mode: AppMode) => void;
  compact?: boolean;
}

// ================================
// 模式图标
// ================================

const MODE_ICONS: Record<AppMode, React.ReactNode> = {
  'code-reader': <Code2 size={18} />,
  reading: <BookOpen size={18} />,
  knowledge: <Brain size={18} />,
  writing: <PenTool size={18} />,
};

// ================================
// ModeSwitch 组件
// ================================

const ModeSwitch: React.FC<ModeSwitchProps> = ({ currentMode, onModeChange, compact = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const currentConfig = APP_MODE_CONFIGS[currentMode];

  // 点击外部时关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 按 Escape 时关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleModeSelect = (mode: AppMode) => {
    onModeChange(mode);
    setIsOpen(false);
  };

  const modes = Object.values(APP_MODE_CONFIGS);

  // 构建类名
  const containerClasses = [styles.modeSwitch, compact ? styles.compact : '']
    .filter(Boolean)
    .join(' ');

  const buttonClasses = [styles.button, isOpen ? styles.active : ''].filter(Boolean).join(' ');

  const chevronClasses = [styles.chevron, isOpen ? styles.rotated : ''].filter(Boolean).join(' ');

  return (
    <div className={containerClasses}>
      {/* 当前模式按钮 */}
      <button
        ref={buttonRef}
        className={buttonClasses}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={`当前模式: ${currentConfig.nameCN}`}
      >
        <span className={styles.modeIcon}>{MODE_ICONS[currentMode]}</span>
        {!compact && (
          <>
            <span className={styles.modeName}>{currentConfig.nameCN}</span>
            <ChevronDown size={14} className={chevronClasses} />
          </>
        )}
      </button>

      {/* 下拉菜单 */}
      {isOpen && (
        <div ref={dropdownRef} className={styles.dropdown} role="listbox" aria-label="选择模式">
          <div className={styles.dropdownHeader}>
            <span className={styles.headerTitle}>切换模式</span>
            <Keyboard size={12} className={styles.headerIcon} />
          </div>

          <div className={styles.dropdownList}>
            {modes.map((config) => {
              const optionClasses = [styles.option, currentMode === config.id ? styles.active : '']
                .filter(Boolean)
                .join(' ');

              return (
                <button
                  key={config.id}
                  className={optionClasses}
                  onClick={() => handleModeSelect(config.id)}
                  role="option"
                  aria-selected={currentMode === config.id}
                >
                  <span className={styles.optionIcon}>{MODE_ICONS[config.id]}</span>
                  <div className={styles.optionContent}>
                    <span className={styles.optionName}>{config.nameCN}</span>
                    <span className={styles.optionDescription}>{config.description}</span>
                  </div>
                  <div className={styles.optionMeta}>
                    {config.shortcut && (
                      <kbd className={styles.optionShortcut}>{config.shortcut}</kbd>
                    )}
                    {currentMode === config.id && (
                      <Check size={14} className={styles.optionCheck} />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className={styles.dropdownFooter}>
            <span className={styles.footerHint}>
              使用快捷键 <kbd>⌘1-4</kbd> 快速切换
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// ================================
// ModeTabs 组件（备选 UI）
// ================================

interface ModeTabsProps {
  currentMode: AppMode;
  onModeChange: (mode: AppMode) => void;
}

export const ModeTabs: React.FC<ModeTabsProps> = ({ currentMode, onModeChange }) => {
  const modes = Object.values(APP_MODE_CONFIGS);

  return (
    <div className={styles.tabs}>
      {modes.map((config) => {
        const tabClasses = [styles.tab, currentMode === config.id ? styles.active : '']
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={config.id}
            className={tabClasses}
            onClick={() => onModeChange(config.id)}
            title={`${config.nameCN} (${config.shortcut})`}
          >
            <span className={styles.tabIcon}>{MODE_ICONS[config.id]}</span>
            <span className={styles.tabName}>{config.nameCN}</span>
          </button>
        );
      })}
    </div>
  );
};

// ================================
// ModeIndicator 组件（最小化）
// ================================

interface ModeIndicatorProps {
  mode: AppMode;
  onClick?: () => void;
}

export const ModeIndicator: React.FC<ModeIndicatorProps> = ({ mode, onClick }) => {
  const config = APP_MODE_CONFIGS[mode];

  return (
    <button className={styles.indicator} onClick={onClick} title={`当前模式: ${config.nameCN}`}>
      <span className={styles.indicatorIcon}>{MODE_ICONS[mode]}</span>
      <span className={styles.indicatorName}>{config.nameCN}</span>
    </button>
  );
};

export default ModeSwitch;

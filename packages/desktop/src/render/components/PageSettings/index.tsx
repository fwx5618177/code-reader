// ================================
// PageSettings 组件
// 编辑器背景和布局设置
// ================================

import React, { useState } from 'react';
import {
  X,
  Minus,
  Grid3X3,
  Circle,
  AlignLeft,
  AlignCenter,
  AlignJustify,
  Maximize2,
  Type,
  Baseline,
  Keyboard,
  Focus,
} from 'lucide-react';
import styles from './PageSettings.module.scss';

// ================================
// 类型定义
// ================================

export type PageBackground = 'none' | 'lines' | 'grid' | 'dots';
export type ContentWidth = 'narrow' | 'medium' | 'wide' | 'full';

export interface PageSettingsConfig {
  // 背景
  background: PageBackground;
  backgroundOpacity: number; // 0-1
  lineSpacing: number; // px，横线背景
  gridSize: number; // px，方格背景
  dotSpacing: number; // px，点阵背景

  // 内容布局
  contentWidth: ContentWidth;
  marginTop: number;
  marginBottom: number;

  // 排版
  fontFamily: string;
  fontSize: number;
  lineHeight: number;

  // 特殊模式
  typewriterMode: boolean; // 当前行居中
  focusMode: boolean; // 高亮当前段落
}

export const DEFAULT_PAGE_SETTINGS: PageSettingsConfig = {
  background: 'none',
  backgroundOpacity: 0.3,
  lineSpacing: 28,
  gridSize: 20,
  dotSpacing: 16,
  contentWidth: 'medium',
  marginTop: 48,
  marginBottom: 48,
  fontFamily: 'system-ui',
  fontSize: 16,
  lineHeight: 1.75,
  typewriterMode: false,
  focusMode: false,
};

interface PageSettingsProps {
  /** 当前设置 */
  settings: PageSettingsConfig;
  /** 设置变更回调 */
  onChange: (settings: PageSettingsConfig) => void;
  /** 面板是否打开 */
  isOpen: boolean;
  /** 关闭面板回调 */
  onClose: () => void;
}

// ================================
// 背景预览组件
// ================================

interface BackgroundPreviewProps {
  type: PageBackground;
  isActive: boolean;
  onClick: () => void;
}

const BackgroundPreview: React.FC<BackgroundPreviewProps> = ({ type, isActive, onClick }) => {
  const getLabel = (): string => {
    switch (type) {
      case 'none':
        return '无';
      case 'lines':
        return '横线';
      case 'grid':
        return '方格';
      case 'dots':
        return '点阵';
      default:
        return '';
    }
  };

  const getIcon = (): React.ReactNode => {
    switch (type) {
      case 'none':
        return <Minus size={16} />;
      case 'lines':
        return <AlignLeft size={16} />;
      case 'grid':
        return <Grid3X3 size={16} />;
      case 'dots':
        return <Circle size={16} />;
      default:
        return null;
    }
  };

  const getPreviewClass = (): string => {
    switch (type) {
      case 'none':
        return styles.bgNone;
      case 'lines':
        return styles.bgLines;
      case 'grid':
        return styles.bgGrid;
      case 'dots':
        return styles.bgDots;
      default:
        return '';
    }
  };

  return (
    <button
      className={`${styles.backgroundOption} ${isActive ? styles.backgroundOptionActive : ''}`}
      onClick={onClick}
      title={getLabel()}
    >
      <div className={`${styles.backgroundPreview} ${getPreviewClass()}`}>{getIcon()}</div>
      <span className={styles.backgroundLabel}>{getLabel()}</span>
    </button>
  );
};

// ================================
// 宽度选项组件
// ================================

interface WidthOptionProps {
  width: ContentWidth;
  isActive: boolean;
  onClick: () => void;
}

const WidthOption: React.FC<WidthOptionProps> = ({ width, isActive, onClick }) => {
  const getLabel = (): string => {
    switch (width) {
      case 'narrow':
        return '窄';
      case 'medium':
        return '中';
      case 'wide':
        return '宽';
      case 'full':
        return '全宽';
      default:
        return '';
    }
  };

  const getIcon = (): React.ReactNode => {
    switch (width) {
      case 'narrow':
        return <AlignCenter size={14} />;
      case 'medium':
        return <AlignJustify size={14} />;
      case 'wide':
        return <AlignJustify size={16} />;
      case 'full':
        return <Maximize2 size={14} />;
      default:
        return null;
    }
  };

  return (
    <button
      className={`${styles.widthOption} ${isActive ? styles.widthOptionActive : ''}`}
      onClick={onClick}
      title={getLabel()}
    >
      {getIcon()}
      <span>{getLabel()}</span>
    </button>
  );
};

// ================================
// 字体选项
// ================================

const FONT_OPTIONS = [
  { value: 'system-ui', label: '系统字体' },
  { value: '"Noto Serif SC", serif', label: '思源宋体' },
  { value: '"Noto Sans SC", sans-serif', label: '思源黑体' },
  { value: '"LXGW WenKai", cursive', label: '霞鹜文楷' },
  { value: '"Source Han Serif SC", serif', label: '思源宋体 SC' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Palatino Linotype", serif', label: 'Palatino' },
];

// ================================
// 主组件
// ================================

const PageSettings: React.FC<PageSettingsProps> = ({ settings, onChange, isOpen, onClose }) => {
  const [localSettings, setLocalSettings] = useState<PageSettingsConfig>(settings);

  // 更新设置并通知父组件
  const updateSettings = (updates: Partial<PageSettingsConfig>): void => {
    const newSettings = { ...localSettings, ...updates };
    setLocalSettings(newSettings);
    onChange(newSettings);
  };

  if (!isOpen) return null;

  return (
    <div className={styles.pageSettingsOverlay} onClick={onClose}>
      <div className={styles.pageSettingsPanel} onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className={styles.pageSettingsHeader}>
          <h3>页面设置</h3>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        {/* 内容区 */}
        <div className={styles.pageSettingsContent}>
          {/* 背景样式 */}
          <section className={styles.settingsSection}>
            <h4 className={styles.sectionTitle}>背景样式</h4>
            <div className={styles.backgroundOptions}>
              {(['none', 'lines', 'grid', 'dots'] as PageBackground[]).map((bg) => (
                <BackgroundPreview
                  key={bg}
                  type={bg}
                  isActive={localSettings.background === bg}
                  onClick={() => updateSettings({ background: bg })}
                />
              ))}
            </div>

            {/* 背景透明度滑块 */}
            {localSettings.background !== 'none' && (
              <div className={styles.sliderControl}>
                <label>背景透明度</label>
                <div className={styles.sliderWrapper}>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.1"
                    value={localSettings.backgroundOpacity}
                    onChange={(e) =>
                      updateSettings({ backgroundOpacity: parseFloat(e.target.value) })
                    }
                  />
                  <span className={styles.sliderValue}>
                    {Math.round(localSettings.backgroundOpacity * 100)}%
                  </span>
                </div>
              </div>
            )}

            {/* 横线间距 */}
            {localSettings.background === 'lines' && (
              <div className={styles.sliderControl}>
                <label>行间距</label>
                <div className={styles.sliderWrapper}>
                  <input
                    type="range"
                    min="20"
                    max="48"
                    step="2"
                    value={localSettings.lineSpacing}
                    onChange={(e) => updateSettings({ lineSpacing: parseInt(e.target.value) })}
                  />
                  <span className={styles.sliderValue}>{localSettings.lineSpacing}px</span>
                </div>
              </div>
            )}

            {/* 网格大小 */}
            {localSettings.background === 'grid' && (
              <div className={styles.sliderControl}>
                <label>网格大小</label>
                <div className={styles.sliderWrapper}>
                  <input
                    type="range"
                    min="12"
                    max="32"
                    step="2"
                    value={localSettings.gridSize}
                    onChange={(e) => updateSettings({ gridSize: parseInt(e.target.value) })}
                  />
                  <span className={styles.sliderValue}>{localSettings.gridSize}px</span>
                </div>
              </div>
            )}

            {/* 点间距 */}
            {localSettings.background === 'dots' && (
              <div className={styles.sliderControl}>
                <label>点间距</label>
                <div className={styles.sliderWrapper}>
                  <input
                    type="range"
                    min="10"
                    max="28"
                    step="2"
                    value={localSettings.dotSpacing}
                    onChange={(e) => updateSettings({ dotSpacing: parseInt(e.target.value) })}
                  />
                  <span className={styles.sliderValue}>{localSettings.dotSpacing}px</span>
                </div>
              </div>
            )}
          </section>

          {/* 内容宽度 */}
          <section className={styles.settingsSection}>
            <h4 className={styles.sectionTitle}>内容宽度</h4>
            <div className={styles.widthOptions}>
              {(['narrow', 'medium', 'wide', 'full'] as ContentWidth[]).map((width) => (
                <WidthOption
                  key={width}
                  width={width}
                  isActive={localSettings.contentWidth === width}
                  onClick={() => updateSettings({ contentWidth: width })}
                />
              ))}
            </div>
          </section>

          {/* 排版设置 */}
          <section className={styles.settingsSection}>
            <h4 className={styles.sectionTitle}>
              <Type size={14} />
              排版
            </h4>

            {/* 字体 */}
            <div className={styles.formControl}>
              <label>字体</label>
              <select
                value={localSettings.fontFamily}
                onChange={(e) => updateSettings({ fontFamily: e.target.value })}
              >
                {FONT_OPTIONS.map((font) => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 字号 */}
            <div className={styles.sliderControl}>
              <label>
                <Baseline size={12} />
                字号
              </label>
              <div className={styles.sliderWrapper}>
                <input
                  type="range"
                  min="12"
                  max="24"
                  step="1"
                  value={localSettings.fontSize}
                  onChange={(e) => updateSettings({ fontSize: parseInt(e.target.value) })}
                />
                <span className={styles.sliderValue}>{localSettings.fontSize}px</span>
              </div>
            </div>

            {/* 行高 */}
            <div className={styles.sliderControl}>
              <label>行高</label>
              <div className={styles.sliderWrapper}>
                <input
                  type="range"
                  min="1.2"
                  max="2.5"
                  step="0.1"
                  value={localSettings.lineHeight}
                  onChange={(e) => updateSettings({ lineHeight: parseFloat(e.target.value) })}
                />
                <span className={styles.sliderValue}>{localSettings.lineHeight.toFixed(1)}</span>
              </div>
            </div>
          </section>

          {/* 特殊模式 */}
          <section className={styles.settingsSection}>
            <h4 className={styles.sectionTitle}>特殊模式</h4>

            {/* 打字机模式 */}
            <label className={styles.toggleControl}>
              <div className={styles.toggleInfo}>
                <Keyboard size={14} />
                <div>
                  <span className={styles.toggleLabel}>打字机模式</span>
                  <span className={styles.toggleDescription}>当前行保持在屏幕中央</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={localSettings.typewriterMode}
                onChange={(e) => updateSettings({ typewriterMode: e.target.checked })}
              />
              <span className={styles.toggleSwitch} />
            </label>

            {/* 聚焦模式 */}
            <label className={styles.toggleControl}>
              <div className={styles.toggleInfo}>
                <Focus size={14} />
                <div>
                  <span className={styles.toggleLabel}>聚焦模式</span>
                  <span className={styles.toggleDescription}>高亮当前段落，淡化其他内容</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={localSettings.focusMode}
                onChange={(e) => updateSettings({ focusMode: e.target.checked })}
              />
              <span className={styles.toggleSwitch} />
            </label>
          </section>
        </div>

        {/* 底部 */}
        <div className={styles.pageSettingsFooter}>
          <button
            className={styles.resetBtn}
            onClick={() => {
              setLocalSettings(DEFAULT_PAGE_SETTINGS);
              onChange(DEFAULT_PAGE_SETTINGS);
            }}
          >
            重置为默认
          </button>
        </div>
      </div>
    </div>
  );
};

export default PageSettings;

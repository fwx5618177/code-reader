// ================================
// ThemeSettings 组件
// 主题外观自定义界面
// ================================

import React, { useCallback } from 'react';
import { Sun, Moon, Monitor, Check, Palette, Type, Minus, Plus, RotateCcw, Puzzle } from 'lucide-react';
import {
  useTheme,
  useThemeMode,
  useAccentColor,
  useFonts,
  ACCENT_COLORS,
  FONT_PRESETS,
  EDITOR_FONT_PRESETS,
  ThemeMode,
} from '../theme';
import styles from './ThemeSettings.module.scss';

// ================================
// 主题模式选择器
// ================================

interface ThemeModeSelectorProps {
  /** null：当前由插件主题决定，内置模式均未选中 */
  value: ThemeMode | null;
  onChange: (mode: ThemeMode) => void;
}

const THEME_MODES: { mode: ThemeMode; icon: React.ReactNode; label: string; labelCN: string }[] = [
  { mode: 'light', icon: <Sun size={16} />, label: 'Light', labelCN: '浅色' },
  { mode: 'dark', icon: <Moon size={16} />, label: 'Dark', labelCN: '深色' },
  { mode: 'system', icon: <Monitor size={16} />, label: 'System', labelCN: '跟随系统' },
];

function ThemeModeSelector({ value, onChange }: ThemeModeSelectorProps): React.ReactElement {
  return (
    <div className={styles.themeModeSelector}>
      {THEME_MODES.map(({ mode, icon, labelCN }) => (
        <button
          key={mode}
          className={`${styles.modeOption} ${value === mode ? styles.modeOptionActive : ''}`}
          onClick={() => onChange(mode)}
          title={labelCN}
        >
          {icon}
          <span>{labelCN}</span>
        </button>
      ))}
    </div>
  );
}

// ================================
// 强调色选择器
// ================================

interface AccentColorSelectorProps {
  selectedId: string;
  isCustom: boolean;
  customColor?: string;
  onSelect: (colorId: string) => void;
  onCustomChange: (color: string) => void;
}

function AccentColorSelector({
  selectedId,
  isCustom,
  customColor,
  onSelect,
  onCustomChange,
}: AccentColorSelectorProps): React.ReactElement {
  return (
    <div className={styles.accentColorSelector}>
      <div className={styles.colorGrid}>
        {ACCENT_COLORS.map((color) => (
          <button
            key={color.id}
            className={`${styles.colorSwatch} ${selectedId === color.id && !isCustom ? styles.colorSwatchActive : ''}`}
            style={{ '--swatch-color': color.primary } as React.CSSProperties}
            onClick={() => onSelect(color.id)}
            title={color.nameCN}
          >
            {selectedId === color.id && !isCustom && <Check size={14} />}
          </button>
        ))}

        {/* 自定义颜色选择器 */}
        <label
          className={`${styles.colorSwatch} ${styles.colorSwatchCustom} ${isCustom ? styles.colorSwatchActive : ''}`}
        >
          <input
            type="color"
            value={customColor || '#7c3aed'}
            onChange={(e) => onCustomChange(e.target.value)}
          />
          <Palette size={14} />
        </label>
      </div>
    </div>
  );
}

// ================================
// 字号控制
// ================================

interface FontSizeControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

function FontSizeControl({
  label,
  value,
  min,
  max,
  onChange,
}: FontSizeControlProps): React.ReactElement {
  const decrease = useCallback(() => {
    if (value > min) onChange(value - 1);
  }, [value, min, onChange]);

  const increase = useCallback(() => {
    if (value < max) onChange(value + 1);
  }, [value, max, onChange]);

  return (
    <div className={styles.fontSizeControl}>
      <label>{label}</label>
      <div className={styles.controlGroup}>
        <button className={styles.sizeBtn} onClick={decrease} disabled={value <= min}>
          <Minus size={14} />
        </button>
        <span className={styles.sizeValue}>{value}px</span>
        <button className={styles.sizeBtn} onClick={increase} disabled={value >= max}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

// ================================
// 字体选择器
// ================================

interface FontFamilySelectorProps {
  label: string;
  value: string;
  presets: Record<string, { id: string; name: string; nameCN?: string; family: string }>;
  onChange: (family: string) => void;
}

function FontFamilySelector({
  label,
  value,
  presets,
  onChange,
}: FontFamilySelectorProps): React.ReactElement {
  return (
    <div className={styles.fontFamilySelector}>
      <label>{label}</label>
      <select
        value={Object.values(presets).find((p) => p.family === value)?.id || 'custom'}
        onChange={(e) => {
          const preset = presets[e.target.value];
          if (preset) {
            onChange(preset.family);
          }
        }}
      >
        {Object.values(presets).map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.nameCN || preset.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ================================
// 开关组件
// ================================

interface ToggleSwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleSwitch({
  label,
  description,
  checked,
  onChange,
}: ToggleSwitchProps): React.ReactElement {
  return (
    <div className={styles.toggleSwitchRow}>
      <div className={styles.toggleInfo}>
        <label>{label}</label>
        {description && <span className={styles.description}>{description}</span>}
      </div>
      <button
        className={`${styles.toggleSwitch} ${checked ? styles.toggleSwitchOn : ''}`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
      >
        <span className={styles.toggleKnob} />
      </button>
    </div>
  );
}

// ================================
// 主组件
// ================================

export interface ThemeSettingsProps {
  className?: string;
}

export function ThemeSettings({ className }: ThemeSettingsProps): React.ReactElement {
  const { config, resetTheme, setReduceMotion, setReduceTransparency, pluginThemes, activePluginTheme, setPluginTheme } =
    useTheme();
  const { mode, setMode } = useThemeMode();
  const { colorId, isCustom, setAccent, setCustom } = useAccentColor();
  const { fonts, setFonts } = useFonts();

  return (
    <div className={`${styles.themeSettings} ${className || ''}`}>
      {/* 主题模式 */}
      <section className={styles.settingsSection}>
        <h3 className={styles.sectionTitle}>
          <Sun size={16} />
          <span>外观模式</span>
        </h3>
        <ThemeModeSelector value={activePluginTheme ? null : mode} onChange={setMode} />
      </section>

      {/* 插件主题：已启用插件声明的配色 */}
      {pluginThemes.length > 0 && (
        <section className={styles.settingsSection}>
          <h3 className={styles.sectionTitle}>
            <Puzzle size={16} />
            <span>插件主题</span>
          </h3>
          <div className={styles.themeModeSelector}>
            {pluginThemes.map((theme) => (
              <button
                key={theme.key}
                className={`${styles.modeOption} ${activePluginTheme?.key === theme.key ? styles.modeOptionActive : ''}`}
                onClick={() => setPluginTheme(activePluginTheme?.key === theme.key ? undefined : theme.key)}
                title={`来自插件「${theme.pluginName}」（${theme.type === 'dark' ? '深色' : '浅色'}），再次点击取消`}
              >
                <span
                  className={styles.pluginThemeSwatch}
                  style={{ '--swatch-color': theme.colors['--bg-primary'] ?? 'transparent' } as React.CSSProperties}
                />
                <span>{theme.label}</span>
              </button>
            ))}
          </div>
          {config.pluginTheme && !activePluginTheme && (
            <p className={styles.pluginThemeNotice}>选用的插件主题当前不可用（插件已停用或卸载），正在使用内置配色</p>
          )}
        </section>
      )}

      {/* 强调色 */}
      <section className={styles.settingsSection}>
        <h3 className={styles.sectionTitle}>
          <Palette size={16} />
          <span>强调色</span>
        </h3>
        <AccentColorSelector
          selectedId={colorId}
          isCustom={isCustom}
          customColor={config.customAccent?.primary}
          onSelect={setAccent}
          onCustomChange={setCustom}
        />
      </section>

      {/* 排版设置 */}
      <section className={styles.settingsSection}>
        <h3 className={styles.sectionTitle}>
          <Type size={16} />
          <span>字体设置</span>
        </h3>

        <FontFamilySelector
          label="界面字体"
          value={fonts.fontFamily}
          presets={FONT_PRESETS}
          onChange={(family) => setFonts({ fontFamily: family })}
        />

        <FontSizeControl
          label="界面字号"
          value={fonts.fontSize}
          min={12}
          max={18}
          onChange={(fontSize) => setFonts({ fontSize })}
        />

        <div className={styles.divider} />

        <FontFamilySelector
          label="编辑器字体"
          value={fonts.editorFontFamily}
          presets={EDITOR_FONT_PRESETS}
          onChange={(family) => setFonts({ editorFontFamily: family })}
        />

        <FontSizeControl
          label="编辑器字号"
          value={fonts.editorFontSize}
          min={12}
          max={24}
          onChange={(editorFontSize) => setFonts({ editorFontSize })}
        />
      </section>

      {/* 辅助功能 */}
      <section className={styles.settingsSection}>
        <h3 className={styles.sectionTitle}>辅助功能</h3>

        <ToggleSwitch
          label="减少动画"
          description="减少或禁用动画效果"
          checked={config.reduceMotion}
          onChange={setReduceMotion}
        />

        <ToggleSwitch
          label="减少透明度"
          description="降低界面透明效果"
          checked={config.reduceTransparency}
          onChange={setReduceTransparency}
        />
      </section>

      {/* 重置 */}
      <section className={styles.settingsSection}>
        <button className={styles.resetBtn} onClick={resetTheme}>
          <RotateCcw size={14} />
          <span>重置为默认</span>
        </button>
      </section>
    </div>
  );
}

export default ThemeSettings;

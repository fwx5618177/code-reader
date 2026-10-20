// ================================
// PageSettings 组件
// 写作 / 专注模式的页面设置浮层：纸张背景、页宽、正文字体、字号、行距、打字机模式，修改即时生效
// ================================

import React from 'react';
import { X } from 'lucide-react';
import {
  PAGE_BACKGROUNDS,
  PAGE_CONTENT_WIDTHS,
  PAGE_FONT_FAMILIES,
  PAGE_SETTING_LIMITS,
  pageLinePx,
  type PageBackground,
  type PageContentWidth,
  type PageFontFamily,
  type PageNumericSetting,
  type PageSettings as PageSettingsValue,
} from '../../lib/editor/page-settings';
import styles from './PageSettings.module.scss';

interface PageSettingsProps {
  settings: PageSettingsValue;
  onChange: (patch: Partial<PageSettingsValue>) => void;
  onReset: () => void;
  onClose: () => void;
}

const BACKGROUND_LABELS: Record<PageBackground, string> = {
  none: '无',
  lines: '横线',
  grid: '方格',
  dots: '点阵',
};

const BACKGROUND_PREVIEW_CLASS: Record<PageBackground, string> = {
  none: '',
  lines: styles.previewLines,
  grid: styles.previewGrid,
  dots: styles.previewDots,
};

const WIDTH_LABELS: Record<PageContentWidth, string> = {
  narrow: '窄',
  medium: '中',
  wide: '宽',
  full: '全宽',
};

const FONT_LABELS: Record<PageFontFamily, string> = {
  sans: '无衬线',
  serif: '衬线',
};

interface SegmentedProps<T extends string> {
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onSelect: (value: T) => void;
  /** 选项按钮附加的 data-font（字体选项用对应字体渲染标签） */
  fontPreview?: boolean;
}

function Segmented<T extends string>({
  options,
  labels,
  value,
  onSelect,
  fontPreview = false,
}: SegmentedProps<T>): React.ReactElement {
  return (
    <div className={styles.segmented}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={`${styles.segment} ${value === option ? styles.segmentActive : ''}`}
          data-font={fontPreview ? option : undefined}
          aria-pressed={value === option}
          onClick={() => onSelect(option)}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

interface SliderRowProps {
  setting: PageNumericSetting;
  label: string;
  value: number;
  display: string;
  onChange: (patch: Partial<PageSettingsValue>) => void;
}

const SliderRow: React.FC<SliderRowProps> = ({ setting, label, value, display, onChange }) => {
  const { min, max, step } = PAGE_SETTING_LIMITS[setting];
  return (
    <label className={styles.sliderRow}>
      <span className={styles.rowLabel}>{label}</span>
      <input
        type="range"
        className={styles.slider}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange({ [setting]: Number(e.target.value) })}
      />
      <span className={styles.sliderValue}>{display}</span>
    </label>
  );
};

const PageSettings: React.FC<PageSettingsProps> = ({ settings, onChange, onReset, onClose }) => (
  <div className={styles.panel} role="dialog" aria-label="页面设置">
    <div className={styles.header}>
      <h3>页面设置</h3>
      <button type="button" className={styles.closeBtn} onClick={onClose} title="关闭 (Esc)">
        <X size={16} />
      </button>
    </div>

    <div className={styles.content}>
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>纸张</h4>
        <div className={styles.backgroundOptions}>
          {PAGE_BACKGROUNDS.map((background) => (
            <button
              key={background}
              type="button"
              className={`${styles.backgroundOption} ${
                settings.background === background ? styles.backgroundOptionActive : ''
              }`}
              aria-pressed={settings.background === background}
              onClick={() => onChange({ background })}
            >
              <span className={`${styles.preview} ${BACKGROUND_PREVIEW_CLASS[background]}`} />
              <span className={styles.backgroundLabel}>{BACKGROUND_LABELS[background]}</span>
            </button>
          ))}
        </div>
        {settings.background !== 'none' && (
          <SliderRow
            setting="ruleOpacity"
            label="线条浓度"
            value={settings.ruleOpacity}
            display={`${Math.round(settings.ruleOpacity * 100)}%`}
            onChange={onChange}
          />
        )}
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>页宽</h4>
        <Segmented
          options={PAGE_CONTENT_WIDTHS}
          labels={WIDTH_LABELS}
          value={settings.contentWidth}
          onSelect={(contentWidth) => onChange({ contentWidth })}
        />
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>正文</h4>
        <Segmented
          options={PAGE_FONT_FAMILIES}
          labels={FONT_LABELS}
          value={settings.fontFamily}
          onSelect={(fontFamily) => onChange({ fontFamily })}
          fontPreview
        />
        <SliderRow
          setting="fontSize"
          label="字号"
          value={settings.fontSize}
          display={`${settings.fontSize}px`}
          onChange={onChange}
        />
        <SliderRow
          setting="lineHeight"
          label="行距"
          value={settings.lineHeight}
          display={`${settings.lineHeight.toFixed(2)} · ${pageLinePx(settings)}px`}
          onChange={onChange}
        />
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>书写</h4>
        <div className={styles.switchRow}>
          <span className={styles.switchInfo}>
            <span className={styles.switchLabel}>打字机模式</span>
            <span className={styles.switchHint}>光标所在行保持在编辑区中央</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={settings.typewriter}
            aria-label="打字机模式"
            className={`${styles.switch} ${settings.typewriter ? styles.switchOn : ''}`}
            onClick={() => onChange({ typewriter: !settings.typewriter })}
          >
            <span className={styles.switchKnob} />
          </button>
        </div>
      </section>
    </div>

    <div className={styles.footer}>
      <button type="button" className={styles.resetBtn} onClick={onReset}>
        恢复默认
      </button>
    </div>
  </div>
);

export default PageSettings;

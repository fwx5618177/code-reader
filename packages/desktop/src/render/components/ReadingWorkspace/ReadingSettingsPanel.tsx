// ================================
// 排版设置面板（字体、字号、行宽、行高）；PDF 另有文字识别语言分区
// ================================

import React from 'react';
import { Minus, Plus } from 'lucide-react';
import {
  READING_SETTING_LIMITS,
  type ReadingFontFamily,
  type ReadingNumericSetting,
  type ReadingSettings,
} from '../../lib/reading';
import { OcrLanguageSettings } from './OcrLanguageSettings';
import styles from './ReadingView.module.scss';

export interface ReadingSettingsPanelProps {
  settings: ReadingSettings;
  onChange: (patch: Partial<ReadingSettings>) => void;
  onReset: () => void;
  /** 显示文字识别语言分区（阅读 PDF 时） */
  showOcrLanguages?: boolean;
}

const FONT_OPTIONS: { value: ReadingFontFamily; label: string }[] = [
  { value: 'serif', label: '衬线' },
  { value: 'sans', label: '无衬线' },
];

const NUMERIC_OPTIONS: {
  key: ReadingNumericSetting;
  label: string;
  format: (value: number) => string;
}[] = [
  { key: 'fontSize', label: '字号', format: (value) => `${value}px` },
  { key: 'lineWidth', label: '行宽', format: (value) => `${value}px` },
  { key: 'lineHeight', label: '行高', format: (value) => value.toFixed(1) },
];

export const ReadingSettingsPanel: React.FC<ReadingSettingsPanelProps> = ({
  settings,
  onChange,
  onReset,
  showOcrLanguages = false,
}) => (
  <div className={styles.settingsPanel} role="dialog" aria-label="排版设置">
    <div className={styles.settingsRow}>
      <span className={styles.settingsLabel}>字体</span>
      <div className={styles.segmented}>
        {FONT_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            className={`${styles.segment} ${settings.fontFamily === value ? styles.segmentActive : ''}`}
            data-font={value}
            onClick={() => onChange({ fontFamily: value })}
          >
            {label}
          </button>
        ))}
      </div>
    </div>

    {NUMERIC_OPTIONS.map(({ key, label, format }) => {
      const { min, max, step } = READING_SETTING_LIMITS[key];
      const value = settings[key];
      return (
        <div key={key} className={styles.settingsRow}>
          <span className={styles.settingsLabel}>{label}</span>
          <div className={styles.stepper}>
            <button
              className={styles.stepperButton}
              disabled={value <= min}
              onClick={() => onChange({ [key]: value - step })}
              aria-label={`减小${label}`}
            >
              <Minus size={12} />
            </button>
            <span className={styles.stepperValue}>{format(value)}</span>
            <button
              className={styles.stepperButton}
              disabled={value >= max}
              onClick={() => onChange({ [key]: value + step })}
              aria-label={`增大${label}`}
            >
              <Plus size={12} />
            </button>
          </div>
        </div>
      );
    })}

    <button className={styles.settingsReset} onClick={onReset}>
      恢复默认
    </button>

    {showOcrLanguages && <OcrLanguageSettings />}
  </div>
);

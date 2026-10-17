// ================================
// 设置项控件：开关、下拉选择（设置面板各标签页共用）
// ================================

import React from 'react';
import styles from './SettingsPanel.module.scss';

interface SettingToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export const SettingToggle: React.FC<SettingToggleProps> = ({ label, description, checked, onChange }) => (
  <div className={styles.settingItem}>
    <div className={styles.settingInfo}>
      <span className={styles.settingLabel}>{label}</span>
      {description && <span className={styles.settingDescription}>{description}</span>}
    </div>
    <label className={styles.toggle}>
      <input
        type="checkbox"
        className={styles.toggleInput}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.toggleSlider} />
    </label>
  </div>
);

interface SettingSelectProps {
  label: string;
  description?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export const SettingSelect: React.FC<SettingSelectProps> = ({
  label,
  description,
  value,
  options,
  onChange,
  disabled,
}) => (
  <div className={styles.settingItem}>
    <div className={styles.settingInfo}>
      <span className={styles.settingLabel}>{label}</span>
      {description && <span className={styles.settingDescription}>{description}</span>}
    </div>
    <select
      className={styles.settingSelect}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);

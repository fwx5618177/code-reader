// ================================
// 标签颜色：调色板取自主题语义色变量，数据库只保存调色板键名，切换主题时颜色自动适配
// ================================

import React from 'react';
import styles from './TagColor.module.scss';

export interface TagColorOption {
  /** 保存到 tags.color 的键名 */
  key: string;
  label: string;
  /** 对应的主题 CSS 变量 */
  value: string;
}

export const TAG_COLORS: TagColorOption[] = [
  { key: 'accent', label: '主题色', value: 'var(--accent-primary)' },
  { key: 'lavender', label: '淡紫', value: 'var(--accent-secondary)' },
  { key: 'blue', label: '蓝', value: 'var(--color-info)' },
  { key: 'teal', label: '青', value: 'var(--code-class-name)' },
  { key: 'green', label: '绿', value: 'var(--color-success)' },
  { key: 'orange', label: '橙', value: 'var(--color-warning)' },
  { key: 'red', label: '红', value: 'var(--color-error)' },
];

const COLOR_VALUES = new Map(TAG_COLORS.map((option) => [option.key, option.value]));

/** 标签颜色以 CSS 自定义属性 --tag-color 传给样式；未设置或未知键名时返回 undefined */
export function tagColorStyle(color: string | undefined): React.CSSProperties | undefined {
  const value = color ? COLOR_VALUES.get(color) : undefined;
  return value ? ({ '--tag-color': value } as React.CSSProperties) : undefined;
}

/** 标签颜色圆点；未设置颜色时不渲染 */
export const TagDot: React.FC<{ color?: string }> = ({ color }) => {
  const style = tagColorStyle(color);
  return style ? <span className={styles.dot} style={style} aria-hidden="true" /> : null;
};

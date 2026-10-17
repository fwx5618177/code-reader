// ================================
// PageSurface：编辑区外层，把页面设置写成 CSS 变量与 data 属性，
// 由内部 RichEditor 的样式读取（字体、字号、行高、纸张背景）
// ================================

import React, { useMemo } from 'react';
import { buildPageStyleVars, type PageSettings } from '../../lib/editor/page-settings';
import styles from './PageSurface.module.scss';

interface PageSurfaceProps {
  settings: PageSettings;
  className?: string;
  children: React.ReactNode;
}

const PageSurface: React.FC<PageSurfaceProps> = ({ settings, className, children }) => {
  const style = useMemo(() => buildPageStyleVars(settings) as React.CSSProperties, [settings]);

  return (
    <div
      className={`${styles.pageSurface} ${className ?? ''}`}
      data-page-background={settings.background}
      data-page-font={settings.fontFamily}
      style={style}
    >
      {children}
    </div>
  );
};

export default PageSurface;

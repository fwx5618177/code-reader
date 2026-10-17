// ================================
// 侧栏面板空状态提示
// ================================

import React from 'react';
import styles from './PanelEmpty.module.scss';

export const PanelEmpty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className={styles.empty}>{children}</div>
);

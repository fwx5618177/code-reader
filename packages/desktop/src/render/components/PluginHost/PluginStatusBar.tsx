// ================================
// 插件状态栏项
// 渲染插件经 statusBar.set 贡献的状态栏项（可点击执行本插件命令），以及命令面板入口
// ================================

import React, { useSyncExternalStore } from 'react';
import { Command } from 'lucide-react';
import { STATUS_BAR_ITEMS } from '../../lib/plugins/extension-registry';
import { pluginService } from '../../services/pluginService';
import { usePluginHost } from './index';
import styles from './PluginStatusBar.module.scss';

const getItems = () => pluginService.registry.get(STATUS_BAR_ITEMS);

const PluginStatusBar: React.FC = () => {
  const items = useSyncExternalStore(pluginService.registry.subscribe, getItems);
  const { openCommandPalette, runCommand } = usePluginHost();

  return (
    <>
      {items.map(({ pluginId, value }) => {
        const { command } = value;
        return command ? (
          <button
            key={pluginId}
            type="button"
            className={`${styles.item} ${styles.clickable}`}
            title={value.tooltip}
            onClick={() => runCommand(pluginId, command)}
          >
            {value.text}
          </button>
        ) : (
          <span key={pluginId} className={styles.item} title={value.tooltip}>
            {value.text}
          </span>
        );
      })}
      <button
        type="button"
        className={`${styles.item} ${styles.clickable}`}
        title="命令面板（⌘⇧P / Ctrl+Shift+P）"
        aria-label="打开命令面板"
        onClick={openCommandPalette}
      >
        <Command size={12} />
      </button>
    </>
  );
};

export default PluginStatusBar;

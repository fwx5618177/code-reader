// ================================
// 插件状态栏项
// 渲染插件经 statusBar.set 贡献的状态栏项（可点击执行本插件命令），以及命令面板入口
// ================================

import React, { useSyncExternalStore } from 'react';
import { Command } from 'lucide-react';
import { getStatusBarItems, subscribeExtensions } from '../../lib/plugins/extension-registry';
import { pluginService } from '../../services/pluginService';
import { usePluginHost } from './index';
import styles from './PluginStatusBar.module.scss';

const subscribe = (listener: () => void) => subscribeExtensions(pluginService.registry, listener);
const getItems = () => getStatusBarItems(pluginService.registry);

const PluginStatusBar: React.FC = () => {
  const items = useSyncExternalStore(subscribe, getItems);
  const { openCommandPalette, runCommand } = usePluginHost();

  return (
    <>
      {items.map(({ pluginId, extension: item }) => {
        const { command } = item;
        return command ? (
          <button
            key={pluginId}
            type="button"
            className={`${styles.item} ${styles.clickable}`}
            title={item.tooltip}
            onClick={() => runCommand(pluginId, command)}
          >
            {item.text}
          </button>
        ) : (
          <span key={pluginId} className={styles.item} title={item.tooltip}>
            {item.text}
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

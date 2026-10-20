// ================================
// 插件视图：侧栏「插件视图」面板
// 视图在 manifest.contributes.views 中声明，内容由插件经 app.views.set(viewId, items) 提供
// （插件运行在没有 DOM 的 Worker 中，视图只能是数据驱动的列表）。点击列表项执行插件命令。
// 面板显示时触发各视图的 onView 激活事件。
// ================================

import React, { useEffect, useSyncExternalStore } from 'react';
import { getViewItems, subscribeExtensions } from '../../lib/plugins/extension-registry';
import { pluginService } from '../../services/pluginService';
import { PanelEmpty } from '../SidebarPanels/PanelEmpty';
import styles from './PluginViews.module.scss';

const getViews = () => pluginService.getSnapshot().contributions.views;
const subscribeContents = (listener: () => void) => subscribeExtensions(pluginService.registry, listener);
const getContents = () => getViewItems(pluginService.registry);

const PluginViewsPanel: React.FC = () => {
  const views = useSyncExternalStore(pluginService.subscribe, getViews);
  const contents = useSyncExternalStore(subscribeContents, getContents);

  useEffect(() => {
    pluginService.notifyViewsShown(views.map((view) => view.id));
  }, [views]);

  if (views.length === 0) {
    return <PanelEmpty>没有插件提供视图。在「设置 → 插件」中启用带视图的插件后会显示在这里</PanelEmpty>;
  }

  return (
    <div className={styles.views}>
      {views.map((view) => {
        const items = contents.find((entry) => entry.pluginId === view.pluginId)?.extension[view.id];
        return (
          <section key={`${view.pluginId}.${view.id}`} className={styles.view} aria-label={view.name}>
            <h3 className={styles.title} title={view.pluginName}>
              {view.name}
            </h3>
            {!items ? (
              <p className={styles.hint}>插件尚未提供内容</p>
            ) : items.length === 0 ? (
              <p className={styles.hint}>（空）</p>
            ) : (
              <ul className={styles.items}>
                {items.map((item, index) => {
                  const { command } = item;
                  const content = (
                    <>
                      <span className={styles.label}>{item.label}</span>
                      {item.description && <span className={styles.description}>{item.description}</span>}
                    </>
                  );
                  return (
                    <li key={`${index}-${item.label}`}>
                      {command ? (
                        <button
                          type="button"
                          className={`${styles.item} ${styles.clickable}`}
                          onClick={() => pluginService.runCommand(view.pluginId, command, item.args)}
                        >
                          {content}
                        </button>
                      ) : (
                        <div className={styles.item}>{content}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default PluginViewsPanel;

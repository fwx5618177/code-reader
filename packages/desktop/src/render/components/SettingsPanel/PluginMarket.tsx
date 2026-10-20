// ================================
// 插件市场：管理市场地址（registry 索引），浏览插件并安装 / 更新到用户插件目录
// 目前没有官方市场服务器；可添加自己或第三方托管的 registry.json（https://、file://，或本机 http://），
// 用 scripts/plugin-tools.ts 的 registry 命令从插件目录生成
// ================================

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Download, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { MarketListing, MarketPlugin } from '../../types/electron';
import { pluginService } from '../../services/pluginService';
import styles from './SettingsPanel.module.scss';
import pluginStyles from './PluginSettings.module.scss';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 安装按钮的文字；null 表示已是最新 */
export function installAction(plugin: MarketPlugin): string | null {
  if (!plugin.installedVersion) return '安装';
  if (plugin.updateAvailable) return `更新到 v${plugin.version}`;
  return plugin.installedSource === 'builtin' ? `安装 v${plugin.version}（覆盖内置）` : null;
}

export const PluginMarket: React.FC = () => {
  const [listing, setListing] = useState<MarketListing | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy('refresh');
    setError(null);
    try {
      setListing(await window.electron.plugins.marketList());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const addRegistry = () =>
    run('add', async () => {
      await window.electron.plugins.marketAddRegistry(url);
      setUrl('');
      setListing(await window.electron.plugins.marketList());
    });

  const removeRegistry = (registry: string) =>
    run(`remove:${registry}`, async () => {
      await window.electron.plugins.marketRemoveRegistry(registry);
      setListing(await window.electron.plugins.marketList());
    });

  const install = (plugin: MarketPlugin) =>
    run(`install:${plugin.registry}:${plugin.id}`, async () => {
      await pluginService.installFromMarket(plugin.registry, plugin.id);
      setNotice(`已安装「${plugin.name}」v${plugin.version}，在“已安装”中启用`);
      setListing(await window.electron.plugins.marketList());
    });

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>插件市场</h3>
        <button className={`${styles.actionButton} ${styles.testBtn}`} disabled={busy !== null} onClick={() => void refresh()}>
          <RefreshCw size={14} />
          <span>刷新</span>
        </button>
      </div>
      <p className={styles.sectionDescription}>
        目前没有官方市场服务器。添加你自己或可信第三方托管的市场索引（registry.json）后即可浏览与安装；安装时校验文件哈希，并按“信任”中的签名策略验签。
      </p>

      <div className={pluginStyles.formRow}>
        <input
          className={styles.settingInput}
          value={url}
          placeholder="https://example.com/plugins/registry.json"
          aria-label="市场地址"
          onChange={(event) => setUrl(event.target.value)}
        />
        <button className={styles.addBtn} disabled={!url.trim() || busy !== null} onClick={() => void addRegistry()}>
          <Plus size={14} />
          <span>添加市场</span>
        </button>
      </div>
      {listing && listing.registries.length > 0 && (
        <ul className={pluginStyles.registryList} aria-label="已添加的市场">
          {listing.registries.map((registry) => (
            <li key={registry}>
              <code>{registry}</code>
              <button
                className={`${styles.actionButton} ${styles.deleteBtn}`}
                disabled={busy !== null}
                aria-label={`移除市场 ${registry}`}
                onClick={() => void removeRegistry(registry)}
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div className={styles.errorBanner} role="alert">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
      {notice && <p className={styles.sectionDescription}>{notice}</p>}
      {listing?.errors.map((failure) => (
        <div key={failure.registry} className={styles.errorBanner}>
          <AlertCircle size={14} />
          <span>
            {failure.registry}：{failure.error}
          </span>
        </div>
      ))}

      {listing && listing.plugins.length === 0 ? (
        <div className={styles.emptyState}>
          <p>{listing.registries.length === 0 ? '还没有添加市场' : '市场中没有插件'}</p>
        </div>
      ) : (
        <div className={styles.settingsList}>
          {listing?.plugins.map((plugin) => {
            const action = installAction(plugin);
            const key = `install:${plugin.registry}:${plugin.id}`;
            return (
              <div key={`${plugin.registry}:${plugin.id}`} className={`${styles.settingItem} ${pluginStyles.card}`}>
                <div className={pluginStyles.header}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingLabel}>
                      {plugin.name}
                      <span className={pluginStyles.version}>v{plugin.version}</span>
                    </span>
                    <span className={pluginStyles.meta}>
                      <span className={pluginStyles.badge}>{plugin.registryName}</span>
                      {plugin.author && <span>作者：{plugin.author}</span>}
                      <code>{plugin.id}</code>
                      {plugin.installedVersion && <span>已安装 v{plugin.installedVersion}</span>}
                    </span>
                  </div>
                  {action ? (
                    <button className={styles.addBtn} disabled={busy !== null} onClick={() => void install(plugin)}>
                      <Download size={14} />
                      <span>{busy === key ? '安装中…' : action}</span>
                    </button>
                  ) : (
                    <span className={pluginStyles.badge}>已是最新</span>
                  )}
                </div>
                {plugin.description && <p className={pluginStyles.description}>{plugin.description}</p>}
                {plugin.permissions.length > 0 && (
                  <div className={pluginStyles.group}>
                    <span className={pluginStyles.groupLabel}>申请权限</span>
                    <ul className={pluginStyles.chips}>
                      {plugin.permissions.map((permission) => (
                        <li key={permission} className={pluginStyles.chip}>
                          {permission}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

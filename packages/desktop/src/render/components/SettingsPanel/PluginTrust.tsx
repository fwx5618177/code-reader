// ================================
// 插件信任设置：签名策略与受信任的签名公钥
// ================================

import React, { useEffect, useState } from 'react';
import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import type { PluginTrustSettings } from '../../types/electron';
import { pluginService } from '../../services/pluginService';
import { SettingSelect } from './SettingControls';
import styles from './SettingsPanel.module.scss';
import pluginStyles from './PluginSettings.module.scss';

const POLICY_OPTIONS = [
  { value: 'warn', label: '允许未签名插件（显示警告）' },
  { value: 'require', label: '只允许受信任签名的插件' },
];

export const PluginTrust: React.FC = () => {
  const [trust, setTrust] = useState<PluginTrustSettings | null>(null);
  const [name, setName] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electron.plugins
      .getTrust()
      .then(setTrust)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  /** 信任设置变化会影响插件能否加载，更新后重新扫描插件列表 */
  const apply = (action: () => Promise<PluginTrustSettings>, after?: () => void) => {
    setError(null);
    action()
      .then(async (next) => {
        setTrust(next);
        after?.();
        await pluginService.refresh();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>签名与信任</h3>
      <p className={styles.sectionDescription}>
        插件作者用 Ed25519 私钥为 manifest.json 与入口文件签名（signature.json）。签名被改动或伪造的插件在任何设置下都不会加载；内置插件随应用分发，不要求签名。
      </p>
      {error && (
        <div className={styles.errorBanner} role="alert">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
      {trust && (
        <>
          <div className={styles.settingsList}>
            <SettingSelect
              label="用户插件的签名要求"
              description="选择“只允许受信任签名”后，未签名或签名者不在下方列表中的插件无法启用与安装"
              value={trust.policy}
              options={POLICY_OPTIONS}
              onChange={(value) => apply(() => window.electron.plugins.setPolicy(value as PluginTrustSettings['policy']))}
            />
          </div>

          <h4 className={styles.sectionTitle}>受信任的签名者</h4>
          {trust.keys.length === 0 ? (
            <p className={styles.sectionDescription}>还没有受信任的签名者</p>
          ) : (
            <ul className={pluginStyles.registryList} aria-label="受信任的签名者">
              {trust.keys.map((key) => (
                <li key={key.keyId}>
                  <span>{key.name}</span>
                  <code>{key.keyId}</code>
                  <button
                    className={`${styles.actionButton} ${styles.deleteBtn}`}
                    aria-label={`移除签名者 ${key.name}`}
                    onClick={() => apply(() => window.electron.plugins.removeTrustedKey(key.keyId))}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className={pluginStyles.formRow}>
            <input
              className={styles.settingInput}
              value={name}
              placeholder="签名者名称"
              aria-label="签名者名称"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <textarea
            className={pluginStyles.keyInput}
            value={publicKey}
            placeholder="粘贴签名者的公钥（plugin-tools keygen 输出的 publicKey）"
            aria-label="签名者公钥"
            onChange={(event) => setPublicKey(event.target.value)}
          />
          <div className={pluginStyles.formRow}>
            <button
              className={styles.addBtn}
              disabled={!name.trim() || !publicKey.trim()}
              onClick={() =>
                apply(
                  () => window.electron.plugins.addTrustedKey(name, publicKey),
                  () => {
                    setName('');
                    setPublicKey('');
                  }
                )
              }
            >
              <Plus size={14} />
              <span>添加受信任签名者</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};

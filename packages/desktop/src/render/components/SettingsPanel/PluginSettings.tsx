// ================================
// 插件设置：已安装（名称、版本、签名、描述、权限、命令、状态；启用/禁用（首次启用时弹出授权对话框）、
// 重新加载、卸载用户插件、打开插件目录）、市场（PluginMarket）、签名与信任（PluginTrust）
// 状态来自 pluginService
// ================================

import React, { useState, useSyncExternalStore } from 'react';
import { AlertCircle, FolderOpen, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { parseActivationEvent } from '@code-reader/plugin-system/lifecycle';
import { ConfirmDialog } from '../InputDialog';
import type { ResolvedKeybinding } from '../../lib/plugins/keybindings';
import { PERMISSION_INFO } from '../../lib/plugins/sandbox';
import type { ConfigurationValue, PluginConfigurationProperty, PluginManifest } from '../../lib/plugins/types';
import { pluginService, type PluginEntry, type PluginStatus } from '../../services/pluginService';
import type { PluginSignatureCheck } from '../../types/electron';
import { PluginMarket } from './PluginMarket';
import { PluginTrust } from './PluginTrust';
import styles from './SettingsPanel.module.scss';
import pluginStyles from './PluginSettings.module.scss';

const STATUS_TEXT: Record<PluginStatus, string> = {
  disabled: '未启用',
  idle: '等待激活',
  loading: '加载中…',
  active: '运行中',
  error: '出错',
};

const LANGUAGE_NAMES: Record<string, string> = { markdown: 'Markdown', latex: 'LaTeX', plain: '纯文本' };

/** 激活事件的说明 */
function describeActivationEvent(event: string, manifest: PluginManifest): string {
  const parsed = parseActivationEvent(event);
  switch (parsed?.kind) {
    case 'onStartup':
      return '启动时';
    case 'onCommand':
      return `执行「${manifest.contributes.commands.find((command) => command.id === parsed.argument)?.title ?? parsed.argument}」时`;
    case 'onLanguage':
      return `打开 ${LANGUAGE_NAMES[parsed.argument ?? ''] ?? parsed.argument} 文档时`;
    case 'onView':
      return `显示视图「${manifest.contributes.views.find((view) => view.id === parsed.argument)?.name ?? parsed.argument}」时`;
    default:
      return event;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 签名状态的徽标文字与说明 */
export function signatureLabel(check: PluginSignatureCheck): { text: string; title: string } {
  switch (check.status) {
    case 'trusted':
      return {
        text: `已签名 · ${check.signer}`,
        title: `签名有效，签名者已受信任（${check.keyId}）`,
      };
    case 'untrusted':
      return { text: '签名者未受信任', title: `签名有效，但签名者 ${check.keyId} 不在信任列表中` };
    case 'invalid':
      return { text: '签名无效', title: check.reason };
    case 'unsigned':
      return { text: '未签名', title: '插件没有签名，无法确认来源' };
  }
}

type PluginTab = 'installed' | 'market' | 'trust';

/** 文本与数字配置：失焦或回车时提交，数字超出范围时不提交并提示 */
const ConfigurationInput: React.FC<{
  id: string;
  property: PluginConfigurationProperty;
  value: ConfigurationValue;
  onCommit: (value: ConfigurationValue) => void;
}> = ({ id, property, value, onCommit }) => {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const [previous, setPrevious] = useState(value);
  if (previous !== value) {
    setPrevious(value);
    setDraft(String(value));
    setInvalid(false);
  }

  const commit = () => {
    if (property.type === 'string') {
      if (draft !== value) onCommit(draft);
      return;
    }
    const number = Number(draft);
    const ok =
      draft.trim() !== '' &&
      Number.isFinite(number) &&
      (property.minimum === undefined || number >= property.minimum) &&
      (property.maximum === undefined || number <= property.maximum);
    setInvalid(!ok);
    if (ok && number !== value) onCommit(number);
  };

  return (
    <input
      id={id}
      type={property.type === 'number' ? 'number' : 'text'}
      className={`${styles.settingInput} ${property.type === 'number' ? styles.settingNumberInput : ''}`}
      value={draft}
      min={property.minimum}
      max={property.maximum}
      aria-invalid={invalid}
      title={invalid ? `请输入${property.minimum ?? '-∞'}～${property.maximum ?? '∞'}之间的数字` : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
};

/** 插件配置表单（manifest.contributes.configuration）：修改即保存，运行中的插件通过 config.onDidChange 收到通知 */
const PluginConfigurationForm: React.FC<{
  title: string;
  properties: Record<string, PluginConfigurationProperty>;
  values: Record<string, ConfigurationValue>;
  onChange: (key: string, value: ConfigurationValue | undefined) => void;
}> = ({ title, properties, values, onChange }) => (
  <fieldset className={pluginStyles.configuration}>
    <legend className={pluginStyles.groupLabel}>{title}</legend>
    {Object.entries(properties).map(([key, property]) => {
      const value = values[key] ?? property.default;
      const id = `plugin-config-${title}-${key}`;
      return (
        <div key={key} className={pluginStyles.configItem}>
          <label htmlFor={id} className={pluginStyles.configLabel}>
            <code>{key}</code>
            {property.description && <span>{property.description}</span>}
          </label>
          <div className={styles.settingInputWrapper}>
            {property.type === 'boolean' ? (
              <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(key, e.target.checked)} />
            ) : property.enum ? (
              <select
                id={id}
                className={styles.settingSelect}
                value={String(value)}
                onChange={(e) =>
                  onChange(key, property.type === 'number' ? Number(e.target.value) : e.target.value)
                }
              >
                {property.enum.map((option, index) => (
                  <option key={String(option)} value={String(option)}>
                    {property.enumDescriptions?.[index] ?? String(option)}
                  </option>
                ))}
              </select>
            ) : (
              <ConfigurationInput id={id} property={property} value={value} onCommit={(next) => onChange(key, next)} />
            )}
            {value !== property.default && (
              <button
                type="button"
                className={pluginStyles.resetButton}
                onClick={() => onChange(key, undefined)}
                title={`恢复默认值：${String(property.default)}`}
                aria-label={`将 ${key} 恢复默认值`}
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>
        </div>
      );
    })}
  </fieldset>
);

const TABS: Array<{ id: PluginTab; label: string }> = [
  { id: 'installed', label: '已安装' },
  { id: 'market', label: '市场' },
  { id: 'trust', label: '签名与信任' },
];

const PluginCard: React.FC<{
  entry: PluginEntry;
  keybindings: readonly ResolvedKeybinding[];
  onToggle: (enabled: boolean) => void;
  onReload: () => void;
  onUninstall: () => void;
  onConfigure: (key: string, value: ConfigurationValue | undefined) => void;
}> = ({ entry, keybindings, onToggle, onReload, onUninstall, onConfigure }) => {
  const { manifest } = entry;
  const granted = new Set(entry.grantedPermissions);
  const commandTitle = (id: string) => manifest?.contributes.commands.find((command) => command.id === id)?.title ?? id;

  return (
    <div className={`${styles.settingItem} ${pluginStyles.card}`}>
      <div className={pluginStyles.header}>
        <div className={styles.settingInfo}>
          <span className={styles.settingLabel}>
            {manifest?.name ?? entry.id}
            {manifest && <span className={pluginStyles.version}>v{manifest.version}</span>}
          </span>
          <span className={pluginStyles.meta}>
            <span className={pluginStyles.badge}>
              {entry.source === 'builtin' ? '内置' : '用户'}
            </span>
            {entry.source === 'user' && entry.signature && (
              <span
                className={`${pluginStyles.signature} ${pluginStyles[entry.signature.status]}`}
                title={signatureLabel(entry.signature).title}
              >
                {signatureLabel(entry.signature).text}
              </span>
            )}
            <span className={`${pluginStyles.status} ${pluginStyles[entry.status]}`}>
              {STATUS_TEXT[entry.status]}
            </span>
            {manifest?.author && <span>作者：{manifest.author}</span>}
            <code>{entry.id}</code>
          </span>
        </div>
        <label className={styles.toggle} title={manifest ? undefined : 'manifest 无效，无法启用'}>
          <input
            type="checkbox"
            className={styles.toggleInput}
            checked={entry.enabled}
            disabled={
              !manifest || entry.status === 'loading' || (!!entry.blocked && !entry.enabled)
            }
            aria-label={`启用 ${manifest?.name ?? entry.id}`}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className={styles.toggleSlider} />
        </label>
      </div>

      {manifest?.description && <p className={pluginStyles.description}>{manifest.description}</p>}

      {manifest && manifest.permissions.length > 0 && (
        <div className={pluginStyles.group}>
          <span className={pluginStyles.groupLabel}>权限</span>
          <ul className={pluginStyles.chips}>
            {manifest.permissions.map((permission) => (
              <li
                key={permission}
                className={`${pluginStyles.chip} ${granted.has(permission) ? pluginStyles.granted : ''}`}
                title={`${permission}${granted.has(permission) ? '（已授权）' : '（未授权，启用时会请求）'}`}
              >
                {PERMISSION_INFO[permission].description}
              </li>
            ))}
          </ul>
        </div>
      )}

      {manifest && manifest.contributes.commands.length > 0 && (
        <div className={pluginStyles.group}>
          <span className={pluginStyles.groupLabel}>命令</span>
          <ul className={pluginStyles.chips}>
            {manifest.contributes.commands.map((command) => (
              <li key={command.id} className={pluginStyles.chip} title={command.description}>
                {command.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      {manifest && manifest.contributes.keybindings.length > 0 && (
        <div className={pluginStyles.group}>
          <span className={pluginStyles.groupLabel}>快捷键</span>
          <ul className={pluginStyles.chips}>
            {manifest.contributes.keybindings.map((binding) => {
              const resolved = keybindings.find(
                (item) => item.pluginId === entry.id && item.binding === binding
              );
              return (
                <li
                  key={`${binding.command}-${binding.key}`}
                  className={`${pluginStyles.chip} ${resolved?.conflict ? pluginStyles.conflict : ''}`}
                  title={resolved?.conflict ?? (binding.when === 'editorFocus' ? '仅在编辑器内生效' : undefined)}
                >
                  <kbd>{resolved?.label ?? binding.key}</kbd> {commandTitle(binding.command)}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {manifest && (manifest.contributes.menus['editor/context'].length > 0 || manifest.contributes.toolbar.length > 0 || manifest.contributes.views.length > 0) && (
        <div className={pluginStyles.group}>
          <span className={pluginStyles.groupLabel}>入口</span>
          <ul className={pluginStyles.chips}>
            {manifest.contributes.menus['editor/context'].map((item) => (
              <li key={`menu-${item.command}`} className={pluginStyles.chip}>
                斜杠菜单：{commandTitle(item.command)}
              </li>
            ))}
            {manifest.contributes.toolbar.map((item) => (
              <li key={`toolbar-${item.command}`} className={pluginStyles.chip}>
                标签栏按钮：{item.tooltip ?? commandTitle(item.command)}
              </li>
            ))}
            {manifest.contributes.views.map((view) => (
              <li key={`view-${view.id}`} className={pluginStyles.chip}>
                侧栏视图：{view.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {manifest && (manifest.dependencies.length > 0 || manifest.activationEvents) && (
        <div className={pluginStyles.group}>
          <span className={pluginStyles.groupLabel}>生命周期</span>
          <ul className={pluginStyles.chips}>
            {manifest.dependencies.map((dependency) => (
              <li key={`dep-${dependency.id}`} className={pluginStyles.chip}>
                依赖 {dependency.id} {dependency.version}
                {dependency.optional ? '（可选）' : ''}
              </li>
            ))}
            {manifest.activationEvents?.map((event) => (
              <li key={`event-${event}`} className={pluginStyles.chip} title={event}>
                {describeActivationEvent(event, manifest)}激活
              </li>
            ))}
          </ul>
        </div>
      )}

      {manifest?.contributes.configuration && (
        <PluginConfigurationForm
          title={manifest.contributes.configuration.title}
          properties={manifest.contributes.configuration.properties}
          values={entry.configuration}
          onChange={onConfigure}
        />
      )}

      {entry.errors.length > 0 && (
        <ul className={pluginStyles.errors}>
          {entry.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <div className={styles.workspaceActions}>
        <button
          className={`${styles.actionButton} ${styles.testBtn}`}
          onClick={onReload}
          disabled={entry.status === 'loading'}
          title="重新读取 manifest 与入口代码"
        >
          <RefreshCw size={14} />
          <span>重新加载</span>
        </button>
        {entry.source === 'user' && (
          <button className={`${styles.actionButton} ${styles.deleteBtn}`} onClick={onUninstall}>
            <Trash2 size={14} />
            <span>卸载</span>
          </button>
        )}
      </div>
    </div>
  );
};

export const PluginSettings: React.FC = () => {
  const snapshot = useSyncExternalStore(pluginService.subscribe, pluginService.getSnapshot);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingUninstall, setPendingUninstall] = useState<PluginEntry | null>(null);
  const [tab, setTab] = useState<PluginTab>('installed');

  const run = (action: () => Promise<unknown>) => {
    setActionError(null);
    action().catch((error: unknown) => setActionError(errorMessage(error)));
  };

  return (
    <div className={styles.settingsTab}>
      <div className={pluginStyles.tabs} role="tablist" aria-label="插件">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'market' && <PluginMarket />}
      {tab === 'trust' && <PluginTrust />}

      {tab === 'installed' && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>插件</h3>
            <div className={styles.workspaceActions}>
              <button
                className={`${styles.actionButton} ${styles.testBtn}`}
                onClick={() => run(() => pluginService.refresh())}
              >
                <RefreshCw size={14} />
                <span>刷新列表</span>
              </button>
              <button
                className={styles.addBtn}
                onClick={() => run(() => pluginService.openDirectory())}
              >
                <FolderOpen size={14} />
                <span>打开插件目录</span>
              </button>
            </div>
          </div>
          <p className={styles.sectionDescription}>
            每个插件是插件目录下的一个子目录（目录名即插件 ID），包含 manifest.json 与入口文件
            main.js。 插件在隔离的后台线程中运行，无法访问网络与本机文件，只能使用你授予的权限。
            启用后可在命令面板（⌘⇧P / Ctrl+Shift+P）中执行插件命令。
          </p>
          {snapshot.pluginsDir && <p className={styles.workspacePath}>{snapshot.pluginsDir}</p>}
          {actionError && (
            <div className={styles.errorBanner}>
              <AlertCircle size={14} />
              <span>{actionError}</span>
            </div>
          )}
          {snapshot.plugins.length === 0 ? (
            <div className={styles.emptyState}>
              <p>{snapshot.initialized ? '没有已安装的插件' : '正在加载插件…'}</p>
            </div>
          ) : (
            <div className={styles.settingsList}>
              {snapshot.plugins.map((entry) => (
                <PluginCard
                  key={entry.id}
                  entry={entry}
                  keybindings={snapshot.contributions.keybindings}
                  onToggle={(enabled) => run(() => pluginService.setEnabled(entry.id, enabled))}
                  onReload={() => run(() => pluginService.reload(entry.id))}
                  onUninstall={() => setPendingUninstall(entry)}
                  onConfigure={(key, value) => run(() => pluginService.setConfiguration(entry.id, key, value))}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={pendingUninstall !== null}
        title="卸载插件"
        message={
          pendingUninstall
            ? `确定卸载「${pendingUninstall.manifest?.name ?? pendingUninstall.id}」吗？插件目录与它保存的数据将被删除。`
            : ''
        }
        isDanger={true}
        onConfirm={() => {
          const target = pendingUninstall;
          setPendingUninstall(null);
          if (target) run(() => pluginService.uninstall(target.id));
        }}
        onCancel={() => setPendingUninstall(null)}
      />
    </div>
  );
};

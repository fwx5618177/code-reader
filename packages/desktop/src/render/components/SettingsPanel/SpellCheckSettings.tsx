// ================================
// 编辑器设置：拼写检查开关、当前词典、导入/删除词典
// 状态来自 spellcheckService，切换词典即时生效（热切换）
// ================================

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../InputDialog';
import { spellcheckService, type SpellcheckStatus } from '../../services/spellcheckService';
import type { SpellcheckDictionaryInfo } from '../../types/electron';
import { SettingSelect, SettingToggle } from './SettingControls';
import styles from './SettingsPanel.module.scss';

const STATUS_TEXT: Record<SpellcheckStatus, string> = {
  idle: '标出拼写错误的单词',
  loading: '正在加载词典…',
  ready: '标出拼写错误的单词，右键查看建议',
  error: '词典不可用',
};

const languageNames = new Intl.DisplayNames(['zh-CN'], { type: 'language' });

/** 语言代码对应的语言名称；文件名不是合法语言代码时返回 undefined */
function languageName(code: string): string | undefined {
  try {
    return languageNames.of(code.replace(/_/g, '-'));
  } catch {
    return undefined;
  }
}

/** 词典显示名：语言代码转为语言名称，如 en_US → 英语（美国）（en_US） */
function dictionaryLabel(info: SpellcheckDictionaryInfo): string {
  const language = languageName(info.name);
  const name = language && language !== info.name ? `${language}（${info.name}）` : info.name;
  return info.source === 'builtin' ? `${name} · 内置` : name;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const SpellCheckSettings: React.FC = () => {
  const snapshot = useSyncExternalStore(spellcheckService.subscribe, spellcheckService.getSnapshot);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<SpellcheckDictionaryInfo | null>(null);

  useEffect(() => {
    void spellcheckService.init();
  }, []);

  const run = (action: () => Promise<unknown>) => {
    setActionError(null);
    action().catch((error: unknown) => setActionError(errorMessage(error)));
  };

  const userDictionaries = snapshot.dictionaries.filter((d) => d.source === 'user');
  const error = actionError ?? snapshot.error;

  return (
    <div className={styles.settingsTab}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>拼写检查</h3>
        <p className={styles.sectionDescription}>
          使用 Hunspell 格式词典检查拉丁字母等文字的单词拼写；中日韩文字、代码、链接、公式与网址不参与检查。
        </p>
        {error && (
          <div className={styles.errorBanner}>
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}
        <div className={styles.settingsList}>
          <SettingToggle
            label="拼写检查"
            description={snapshot.enabled ? STATUS_TEXT[snapshot.status] : '关闭后不再标出拼写错误'}
            checked={snapshot.enabled}
            onChange={(checked) => run(() => spellcheckService.setEnabled(checked))}
          />
          <SettingSelect
            label="词典"
            description="切换后立即生效，无需重启"
            value={snapshot.dictionaryId}
            options={snapshot.dictionaries.map((d) => ({ value: d.id, label: dictionaryLabel(d) }))}
            disabled={snapshot.status === 'loading'}
            onChange={(id) => run(() => spellcheckService.selectDictionary(id))}
          />
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>导入的词典</h3>
          <button className={styles.addBtn} onClick={() => run(() => spellcheckService.importDictionary())}>
            <Plus size={14} />
            <span>导入词典</span>
          </button>
        </div>
        <p className={styles.sectionDescription}>
          选择同名的 .dic 与 .aff 文件，或 LibreOffice 词典扩展（.oxt）；导入后自动切换到新词典。
        </p>
        {userDictionaries.length > 0 && (
          <div className={styles.settingsList}>
            {userDictionaries.map((d) => (
              <div key={d.id} className={styles.settingItem}>
                <div className={styles.settingInfo}>
                  <span className={styles.settingLabel}>{dictionaryLabel(d)}</span>
                </div>
                <button
                  className={`${styles.actionButton} ${styles.deleteBtn}`}
                  onClick={() => setPendingRemoval(d)}
                >
                  <Trash2 size={14} />
                  <span>删除</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={pendingRemoval !== null}
        title="删除词典"
        message={pendingRemoval ? `确定删除词典「${dictionaryLabel(pendingRemoval)}」吗？正在使用时将切换回内置词典。` : ''}
        isDanger={true}
        onConfirm={() => {
          const target = pendingRemoval;
          setPendingRemoval(null);
          if (target) run(() => spellcheckService.removeDictionary(target.id));
        }}
        onCancel={() => setPendingRemoval(null)}
      />
    </div>
  );
};

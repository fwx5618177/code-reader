// ================================
// 版本保留设置：分层保留策略（最近全部保留，之后按日/周/月抽样）与立即清理
// 策略保存在当前知识库的数据库中，每次新增版本后自动按策略清理该文档
// ================================

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Eraser, Save } from 'lucide-react';
import { ConfirmDialog } from '../InputDialog';
import { versionService } from '../../lib/documents/versions/service';
import type { VersionRetentionPolicy, VersionStats } from '../../lib/documents/versions/types';
import styles from './SettingsPanel.module.scss';

type PolicyKey = keyof VersionRetentionPolicy;

/** 输入中的草稿（允许暂时为空） */
type PolicyDraft = Record<PolicyKey, string>;

const FIELDS: Array<{ key: PolicyKey; label: string; unit: string; description: string }> = [
  { key: 'keepAllHours', label: '全部保留', unit: '小时', description: '这段时间内的每个版本都保留' },
  { key: 'dailyDays', label: '每天保留一个', unit: '天内', description: '此后每个自然日只保留当天最后一个版本' },
  { key: 'weeklyWeeks', label: '每周保留一个', unit: '周内', description: '此后每周只保留一个，更早的每月保留一个' },
];

function toDraft(policy: VersionRetentionPolicy): PolicyDraft {
  return {
    keepAllHours: String(policy.keepAllHours),
    dailyDays: String(policy.dailyDays),
    weeklyWeeks: String(policy.weeklyWeeks),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 策略的文字说明 */
function describePolicy(policy: VersionRetentionPolicy): string {
  return (
    `最近 ${policy.keepAllHours} 小时内的版本全部保留；${policy.dailyDays} 天内每天保留最后一个；` +
    `${policy.weeklyWeeks} 周内每周保留一个；更早的每月保留一个。每篇文档的最新版本始终保留。`
  );
}

export const VersionRetentionSettings: React.FC = () => {
  const [policy, setPolicy] = useState<VersionRetentionPolicy | null>(null);
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [stats, setStats] = useState<VersionStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmPrune, setConfirmPrune] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStats = useCallback(() => versionService.getStats().then(setStats), []);

  useEffect(() => {
    Promise.all([versionService.getRetentionPolicy(), refreshStats()])
      .then(([loaded]) => {
        setPolicy(loaded);
        setDraft(toDraft(loaded));
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [refreshStats]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const dirty = !!policy && !!draft && FIELDS.some(({ key }) => draft[key] !== String(policy[key]));

  const handleSave = () =>
    run(async () => {
      if (!draft) return;
      const requested: VersionRetentionPolicy = {
        keepAllHours: Number(draft.keepAllHours),
        dailyDays: Number(draft.dailyDays),
        weeklyWeeks: Number(draft.weeklyWeeks),
      };
      const saved = await versionService.setRetentionPolicy(requested);
      setPolicy(saved);
      setDraft(toDraft(saved));
      const adjusted = FIELDS.some(({ key }) => saved[key] !== requested[key]);
      setNotice(adjusted ? '已保存（部分数值超出范围或层级重叠，已自动调整）' : '已保存，新增版本时按新策略清理');
    });

  const handlePrune = () =>
    run(async () => {
      const result = await versionService.pruneAllVersions();
      await refreshStats();
      setNotice(
        result.deletedCount === 0
          ? '没有需要清理的版本'
          : `已删除 ${result.itemCount} 篇文档中的 ${result.deletedCount} 个旧版本`
      );
    });

  return (
    <div className={styles.settingsTab}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>版本保留</h3>
        <p className={styles.sectionDescription}>
          {policy ? describePolicy(policy) : '正在读取保留策略…'}
          自然日、周（周一开始）与月按本机时区划分。
        </p>
        {error && (
          <div className={styles.errorBanner}>
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}
        {draft && (
          <div className={styles.settingsList}>
            {FIELDS.map(({ key, label, unit, description }) => (
              <div key={key} className={styles.settingItem}>
                <div className={styles.settingInfo}>
                  <span className={styles.settingLabel}>{label}</span>
                  <span className={styles.settingDescription}>{description}</span>
                </div>
                <div className={styles.settingInputWrapper}>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className={`${styles.settingInput} ${styles.settingNumberInput}`}
                    aria-label={`${label}（${unit}）`}
                    value={draft[key]}
                    onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                  />
                  <span className={styles.settingUnit}>{unit}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className={styles.retentionActions}>
          <button
            className={`${styles.actionButton} ${styles.saveBtn}`}
            disabled={!dirty || busy}
            onClick={() => void handleSave()}
          >
            <Save size={14} />
            <span>保存策略</span>
          </button>
          <button
            className={`${styles.actionButton} ${styles.testBtn}`}
            disabled={dirty || busy || !policy}
            title={dirty ? '请先保存策略' : '按当前策略清理所有文档的旧版本'}
            onClick={() => setConfirmPrune(true)}
          >
            <Eraser size={14} />
            <span>立即清理</span>
          </button>
          {stats && (
            <span className={styles.settingDescription}>
              当前共 {stats.versionCount} 个版本（{stats.itemCount} 篇文档）
            </span>
          )}
        </div>
        {notice && <p className={styles.sectionDescription}>{notice}</p>}
      </div>

      <ConfirmDialog
        isOpen={confirmPrune}
        title="立即清理旧版本"
        message={policy ? `将删除所有文档中策略之外的旧版本，删除后无法恢复。${describePolicy(policy)}` : ''}
        isDanger={true}
        onConfirm={() => {
          setConfirmPrune(false);
          void handlePrune();
        }}
        onCancel={() => setConfirmPrune(false)}
      />
    </div>
  );
};

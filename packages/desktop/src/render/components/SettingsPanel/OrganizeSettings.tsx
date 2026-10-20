// ================================
// 定期整理建议设置：开关与间隔；到期且有新条目时由主进程自动提交整库归类，
// 结果进入“待审阅归类”，不会直接改动知识库。设置保存在当前知识库
// ================================

import React, { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { OrganizeStatus } from '../../types/electron';
import { SettingSelect, SettingToggle } from './SettingControls';
import styles from './SettingsPanel.module.scss';

const INTERVAL_OPTIONS = [
  { value: '1', label: '每天' },
  { value: '3', label: '每 3 天' },
  { value: '7', label: '每周' },
  { value: '14', label: '每两周' },
  { value: '30', label: '每月' },
];

function formatTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';
}

/** 状态说明 */
export function describeOrganizeStatus(status: OrganizeStatus, now: Date = new Date()): string {
  if (!status.enabled) return '未开启。也可以随时在知识库工具栏点“自动归类”手动整理。';
  const since = `自 ${formatTime(status.lastRunAt)} 以来新增 ${status.newItemCount} 个条目`;
  if (status.newItemCount === 0) return `${since}；有新条目后才会整理。`;
  const due = status.nextRunAt && Date.parse(status.nextRunAt) <= now.getTime();
  return due
    ? `${since}；已到期，将在半小时内自动整理（需要可用的 AI 服务）。`
    : `${since}；下次整理时间：${formatTime(status.nextRunAt)}。`;
}

export const OrganizeSettings: React.FC = () => {
  const [status, setStatus] = useState<OrganizeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electron.organize
      .getStatus()
      .then(setStatus)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const update = (input: { enabled?: boolean; intervalDays?: number }) => {
    setError(null);
    window.electron.organize
      .update(input)
      .then(setStatus)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>定期整理建议</h3>
      <p className={styles.sectionDescription}>
        按设定的间隔，在有新条目时自动对当前知识库做一次“自动归类”，结果进入“待审阅归类”，接受后才生效；窗口不在前台时会发送系统通知。
      </p>
      {error && (
        <div className={styles.errorBanner}>
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
      {status && (
        <>
          <div className={styles.settingsList}>
            <SettingToggle
              label="开启定期整理"
              description="只对当前知识库生效，各知识库分别设置"
              checked={status.enabled}
              onChange={(enabled) => update({ enabled })}
            />
            <SettingSelect
              label="整理间隔"
              value={String(status.intervalDays)}
              options={INTERVAL_OPTIONS}
              disabled={!status.enabled}
              onChange={(value) => update({ intervalDays: Number(value) })}
            />
          </div>
          <p className={styles.sectionDescription}>{describeOrganizeStatus(status)}</p>
        </>
      )}
    </div>
  );
};

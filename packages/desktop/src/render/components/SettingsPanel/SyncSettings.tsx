// ================================
// 多设备同步设置：选择共享文件夹（加入已有或新建，可选口令加密）、设备名、定时同步、立即同步、设备列表、断开
// 同步经由用户自己的文件夹完成（iCloud Drive / Dropbox / OneDrive / Syncthing / NAS），不是云服务
// ================================

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, FolderOpen, Lock, RefreshCw, Unplug } from 'lucide-react';
import type { SyncFolderInspection, SyncStatus } from '../../types/electron';
import { refreshAfterSync } from '../../lib/sync/refresh';
import { ConfirmDialog } from '../InputDialog';
import { SettingSelect, SettingToggle } from './SettingControls';
import styles from './SettingsPanel.module.scss';
import dataStyles from './DataSettings.module.scss';

const INTERVAL_OPTIONS = [
  { value: '5', label: '每 5 分钟' },
  { value: '15', label: '每 15 分钟' },
  { value: '30', label: '每 30 分钟' },
  { value: '60', label: '每小时' },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '从未';
}

/** 上次同步结果的说明 */
export function describeLastSync(status: SyncStatus): string {
  if (status.lastError) return `上次同步失败（${formatTime(status.lastSyncAt)}）：${status.lastError}`;
  if (!status.lastResult) return `上次同步：${formatTime(status.lastSyncAt)}`;
  const { exported, applied, conflicts, deferred } = status.lastResult;
  const parts = [`发出 ${exported} 项修改`, `收到 ${applied} 项修改`];
  if (conflicts > 0) parts.push(`${conflicts} 处冲突已另存为“冲突副本”`);
  if (deferred > 0) parts.push(`${deferred} 批修改等待附件同步完成`);
  return `上次同步：${formatTime(status.lastSyncAt)}，${parts.join('，')}`;
}

export const SyncSettings: React.FC = () => {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [inspection, setInspection] = useState<SyncFolderInspection | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await window.electron.sync.getStatus();
    setStatus(next);
    setDeviceName(next.deviceName);
  }, []);

  useEffect(() => {
    reload().catch((e: unknown) => setError(errorMessage(e)));
  }, [reload]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      await reload().catch(() => undefined);
    }
  };

  const chooseFolder = () =>
    run(async () => {
      setPassphrase('');
      setConfirmPassphrase('');
      setInspection(await window.electron.sync.chooseFolder());
    });

  const connect = () =>
    run(async () => {
      if (!inspection) return;
      if (!inspection.exists && passphrase && passphrase !== confirmPassphrase) throw new Error('两次输入的口令不一致');
      const result = await window.electron.sync.connect({ folder: inspection.folder, passphrase: passphrase || undefined });
      setInspection(null);
      setPassphrase('');
      setConfirmPassphrase('');
      if (result.changedItemIds.length > 0) await refreshAfterSync(result.changedItemIds);
    });

  const syncNow = () =>
    run(async () => {
      const result = await window.electron.sync.runNow();
      if (result.changedItemIds.length > 0) await refreshAfterSync(result.changedItemIds);
    });

  const saveDeviceName = () => {
    if (!status || !deviceName.trim() || deviceName.trim() === status.deviceName) return;
    void run(() => window.electron.sync.update({ deviceName }));
  };

  const connected = !!status?.folder;

  return (
    <div className={styles.settingsTab}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>多设备同步</h3>
        <p className={styles.sectionDescription}>
          这不是云服务：选择一个会被你自己的同步工具（iCloud Drive、Dropbox、OneDrive、Syncthing、NAS 共享目录等）同步到其他设备的文件夹，每台设备都连接到同一个文件夹即可。
          同步当前知识库的条目、标签、文件夹与附件；同一篇笔记在两台设备上同时被修改时，较新的修改生效，另一份另存为“冲突副本”。语义索引与 AI 结果中的实体在各设备上分别生成。
        </p>
        {error && (
          <div className={styles.errorBanner} role="alert">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {status && (
          <div className={styles.settingsList}>
            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>本机名称</span>
                <span className={styles.settingDescription}>显示在其他设备的设备列表与冲突副本标题中</span>
              </div>
              <input
                className={styles.settingInput}
                value={deviceName}
                aria-label="本机名称"
                onChange={(event) => setDeviceName(event.target.value)}
                onBlur={saveDeviceName}
              />
            </div>
          </div>
        )}
      </div>

      {status && !connected && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>连接同步文件夹</h3>
          <div className={dataStyles.actions}>
            <button className={styles.addBtn} disabled={busy} onClick={() => void chooseFolder()}>
              <FolderOpen size={14} />
              <span>选择同步文件夹…</span>
            </button>
          </div>
          {inspection && (
            <div className={dataStyles.preview} aria-label="同步文件夹">
              <p>{inspection.folder}</p>
              <p>
                {inspection.exists
                  ? `已有同步数据（${inspection.devices} 台设备）${inspection.encrypted ? '，已加密' : ''}，连接后会合并本机与文件夹中的内容`
                  : '新的同步文件夹，连接后上传本机的全部内容'}
              </p>
              {(inspection.encrypted || !inspection.exists) && (
                <input
                  type="password"
                  className={styles.settingInput}
                  value={passphrase}
                  placeholder={inspection.exists ? '同步口令' : '同步口令（可选，填写即启用加密）'}
                  aria-label="同步口令"
                  onChange={(event) => setPassphrase(event.target.value)}
                />
              )}
              {!inspection.exists && passphrase && (
                <input
                  type="password"
                  className={styles.settingInput}
                  value={confirmPassphrase}
                  placeholder="再次输入口令"
                  aria-label="确认同步口令"
                  onChange={(event) => setConfirmPassphrase(event.target.value)}
                />
              )}
              {!inspection.exists && passphrase && (
                <p>口令无法找回：忘记后其他设备将无法加入，已同步的数据仍保留在各设备上。</p>
              )}
              <div className={dataStyles.actions}>
                <button
                  className={`${styles.actionButton} ${styles.saveBtn}`}
                  disabled={busy || (inspection.encrypted && !passphrase)}
                  onClick={() => void connect()}
                >
                  <span>{busy ? '正在同步…' : inspection.exists ? '加入并同步' : '创建并同步'}</span>
                </button>
                <button className={`${styles.actionButton} ${styles.testBtn}`} disabled={busy} onClick={() => setInspection(null)}>
                  <span>取消</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {status && connected && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            同步文件夹 {status.encrypted && <Lock size={13} aria-label="已加密" />}
          </h3>
          <p className={styles.workspacePath}>{status.folder}</p>
          {status.needsPassphrase && (
            <div className={dataStyles.preview}>
              <p>同步文件夹已加密，本机需要输入口令后才能同步。</p>
              <input
                type="password"
                className={styles.settingInput}
                value={passphrase}
                placeholder="同步口令"
                aria-label="同步口令"
                onChange={(event) => setPassphrase(event.target.value)}
              />
              <div className={dataStyles.actions}>
                <button
                  className={`${styles.actionButton} ${styles.saveBtn}`}
                  disabled={busy || !passphrase}
                  onClick={() =>
                    void run(async () => {
                      await window.electron.sync.providePassphrase(passphrase);
                      setPassphrase('');
                    })
                  }
                >
                  <span>解锁</span>
                </button>
              </div>
            </div>
          )}
          <div className={styles.settingsList}>
            <SettingToggle
              label="自动同步"
              description="启动后约半分钟同步一次，之后按间隔定时同步"
              checked={status.enabled}
              onChange={(enabled) => void run(() => window.electron.sync.update({ enabled }))}
            />
            <SettingSelect
              label="同步间隔"
              value={String(status.intervalMinutes)}
              options={INTERVAL_OPTIONS}
              disabled={!status.enabled}
              onChange={(value) => void run(() => window.electron.sync.update({ intervalMinutes: Number(value) }))}
            />
          </div>
          <p className={styles.sectionDescription} aria-label="上次同步">
            {describeLastSync(status)}
          </p>
          <div className={dataStyles.actions}>
            <button
              className={`${styles.actionButton} ${styles.saveBtn}`}
              disabled={busy || status.running || status.needsPassphrase}
              onClick={() => void syncNow()}
            >
              <RefreshCw size={14} />
              <span>{busy || status.running ? '正在同步…' : '立即同步'}</span>
            </button>
            <button className={`${styles.actionButton} ${styles.deleteBtn}`} disabled={busy} onClick={() => setConfirmDisconnect(true)}>
              <Unplug size={14} />
              <span>断开</span>
            </button>
          </div>

          <h4 className={styles.sectionTitle}>设备</h4>
          {status.devices.length === 0 ? (
            <p className={styles.sectionDescription}>同步文件夹中还没有设备</p>
          ) : (
            <ul className={dataStyles.backupList} aria-label="同步设备">
              {status.devices.map((device) => (
                <li key={device.deviceId} className={dataStyles.backupRow}>
                  <span className={dataStyles.backupName}>
                    {device.name}
                    {device.deviceId === status.deviceId && '（本机）'}
                  </span>
                  <span className={dataStyles.backupMeta}>
                    {device.lastSeq} 批修改 · 最近 {formatTime(device.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDisconnect}
        title="断开同步"
        message="断开后本机不再与同步文件夹交换修改，本机与文件夹中的数据都保留；之后可以重新连接。"
        onConfirm={() => {
          setConfirmDisconnect(false);
          void run(() => window.electron.sync.disconnect());
        }}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </div>
  );
};

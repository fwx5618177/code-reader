// ================================
// 数据设置：批量导入（Obsidian / Notion / 印象笔记 / 本应用 JSON）、导出（Markdown / JSON）、备份与恢复
// 导入先解析并预览，确认后写入；导入与导出都显示进度与结果。恢复备份由主进程确认并重新加载窗口
// ================================

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Archive, DatabaseBackup, Download, FolderOpen, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { BackupFileInfo, ImportSource, ImportSourceKind } from '../../types/electron';
import { knowledgeRepository } from '../../lib/knowledge/repository';
import { folderRepository } from '../../lib/folders/repository';
import { notifyKnowledgeChanged } from '../../lib/knowledge/changes';
import { workspaceService } from '../../services/workspaceService';
import { IMPORT_SOURCE_LABELS, parseImportSource, runImport, type ImportResult } from '../../lib/transfer/importer';
import { writeExport, type ExportFormat, type ExportResult } from '../../lib/transfer/exporter';
import type { ImportPlan } from '../../lib/transfer/types';
import { ConfirmDialog } from '../InputDialog';
import settingsStyles from './SettingsPanel.module.scss';
import styles from './DataSettings.module.scss';

const IMPORT_KINDS: Array<{ kind: ImportSourceKind; description: string }> = [
  { kind: 'obsidian', description: '选择库文件夹：Markdown 笔记、附件、文件夹、标签与 [[链接]]' },
  { kind: 'notion', description: '选择“Markdown & CSV”导出的 .zip：页面、图片、数据库表格' },
  { kind: 'evernote', description: '选择 .enex 文件（可多选）：笔记、图片与附件、标签、来源网址' },
  { kind: 'json', description: '选择本应用导出的 knowledge-export.json，完整还原条目与附件' },
];

type ImportState =
  | { phase: 'idle' }
  | { phase: 'preview'; source: ImportSource; plan: ImportPlan }
  | { phase: 'running'; label: string; done: number; total: number }
  | { phase: 'done'; result: ImportResult };

type ExportState =
  | { phase: 'idle' }
  | { phase: 'running'; done: number; total: number }
  | { phase: 'done'; result: ExportResult };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 导入预览的统计 */
export function summarizePlan(plan: ImportPlan): { notes: number; attachments: number; tags: number; folders: number } {
  const tags = new Set(plan.entries.flatMap((entry) => entry.tags));
  const folders = new Set(plan.entries.filter((entry) => entry.folderPath.length > 0).map((entry) => entry.folderPath.join('/')));
  for (const path of plan.folders ?? []) folders.add(path.join('/'));
  const attachments = plan.entries.filter((entry) => entry.file).length;
  return { notes: plan.entries.length - attachments, attachments, tags: tags.size, folders: folders.size };
}

const Progress: React.FC<{ done: number; total: number; label: string }> = ({ done, total, label }) => (
  <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label}>
    <div className={styles.progressBar} style={{ width: `${total ? (done / total) * 100 : 100}%` }} />
    <span className={styles.progressText}>
      {label} {done} / {total}
    </span>
  </div>
);

export const DataSettings: React.FC = () => {
  const [importState, setImportState] = useState<ImportState>({ phase: 'idle' });
  const [exportState, setExportState] = useState<ExportState>({ phase: 'idle' });
  const [backups, setBackups] = useState<BackupFileInfo[]>([]);
  const [deleting, setDeleting] = useState<BackupFileInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshBackups = useCallback(
    () => window.electron.backup.list().then(setBackups).catch((e: unknown) => setError(errorMessage(e))),
    []
  );
  useEffect(() => {
    void refreshBackups();
  }, [refreshBackups]);

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

  // ---------- 导入 ----------

  const pickSource = (kind: ImportSourceKind) =>
    run(async () => {
      const source = await window.electron.transfer.pickImportSource(kind);
      if (!source) return;
      try {
        const plan = parseImportSource(source);
        if (plan.entries.length === 0) {
          await window.electron.transfer.finishImport(source.id);
          setError(['没有找到可导入的内容', ...plan.warnings].join('；'));
          return;
        }
        setImportState({ phase: 'preview', source, plan });
      } catch (e) {
        await window.electron.transfer.finishImport(source.id);
        throw e;
      }
    });

  const cancelImport = () => {
    if (importState.phase === 'preview') void window.electron.transfer.finishImport(importState.source.id);
    setImportState({ phase: 'idle' });
  };

  const startImport = () => {
    if (importState.phase !== 'preview') return;
    const { source, plan } = importState;
    void run(async () => {
      const label = `正在导入 ${IMPORT_SOURCE_LABELS[source.kind]}`;
      setImportState({ phase: 'running', label, done: 0, total: plan.entries.length });
      try {
        const result = await runImport(source, plan, ({ done, total }) =>
          setImportState({ phase: 'running', label, done, total })
        );
        setImportState({ phase: 'done', result });
      } catch (e) {
        setImportState({ phase: 'idle' });
        throw e;
      } finally {
        await window.electron.transfer.finishImport(source.id);
        notifyKnowledgeChanged();
      }
    });
  };

  // ---------- 导出 ----------

  const startExport = (format: ExportFormat) =>
    run(async () => {
      const target = await window.electron.transfer.pickExportDirectory(format === 'json' ? 'JSON导出' : 'Markdown导出');
      if (!target) return;
      try {
        const [items, tags, folders, workspace] = await Promise.all([
          knowledgeRepository.listAll(),
          knowledgeRepository.listTags(),
          folderRepository.getAll(),
          workspaceService.getCurrent(),
        ]);
        setExportState({ phase: 'running', done: 0, total: items.length });
        const result = await writeExport(target.id, target.path, format, { workspace: workspace.name, items, tags, folders }, (progress) =>
          setExportState({ phase: 'running', ...progress })
        );
        setExportState({ phase: 'done', result });
      } catch (e) {
        setExportState({ phase: 'idle' });
        throw e;
      } finally {
        await window.electron.transfer.finishExport(target.id);
      }
    });

  // ---------- 备份 ----------

  const createBackup = () =>
    run(async () => {
      const backup = await window.electron.backup.create();
      setNotice(`已备份：${backup.fileName}（${formatSize(backup.size)}）`);
      await refreshBackups();
    });

  const exportFull = () =>
    run(async () => {
      const path = await window.electron.backup.exportFull();
      if (path) setNotice(`完整备份已写入：${path}`);
    });

  const confirmDelete = () => {
    if (!deleting) return;
    const { fileName } = deleting;
    setDeleting(null);
    void run(async () => {
      await window.electron.backup.remove(fileName);
      await refreshBackups();
    });
  };

  const summary = importState.phase === 'preview' ? summarizePlan(importState.plan) : null;
  const running = importState.phase === 'running' || exportState.phase === 'running';

  return (
    <div className={settingsStyles.settingsTab}>
      {error && (
        <div className={settingsStyles.errorBanner} role="alert">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
      {notice && <p className={settingsStyles.sectionDescription}>{notice}</p>}

      <div className={settingsStyles.section}>
        <h3 className={settingsStyles.sectionTitle}>导入</h3>
        <p className={settingsStyles.sectionDescription}>
          导入的内容放在新建的顶层文件夹「导入 · 来源 · 名称」中，保留原有的目录结构；与已有条目重名时自动加序号，并同步改写链接。导入后不会自动交给 AI 处理。
        </p>
        {importState.phase === 'preview' && summary ? (
          <div className={styles.preview} aria-label="导入预览">
            <p>
              来源：{IMPORT_SOURCE_LABELS[importState.source.kind]} · {importState.source.name}
            </p>
            <p>
              将导入 {summary.notes} 篇笔记、{summary.attachments} 个附件，{summary.tags} 个标签，{summary.folders} 个文件夹
            </p>
            {importState.plan.warnings.length > 0 && (
              <ul className={styles.warnings}>
                {importState.plan.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <div className={styles.actions}>
              <button className={`${settingsStyles.actionButton} ${settingsStyles.saveBtn}`} disabled={busy} onClick={startImport}>
                <Upload size={14} />
                <span>开始导入</span>
              </button>
              <button className={`${settingsStyles.actionButton} ${settingsStyles.testBtn}`} disabled={busy} onClick={cancelImport}>
                <span>取消</span>
              </button>
            </div>
          </div>
        ) : importState.phase === 'running' ? (
          <Progress done={importState.done} total={importState.total} label={importState.label} />
        ) : (
          <div className={styles.sourceGrid}>
            {IMPORT_KINDS.map(({ kind, description }) => (
              <button key={kind} className={styles.sourceCard} disabled={busy || running} onClick={() => void pickSource(kind)}>
                <span className={styles.sourceName}>{IMPORT_SOURCE_LABELS[kind]}</span>
                <span className={styles.sourceDescription}>{description}</span>
              </button>
            ))}
          </div>
        )}
        {importState.phase === 'done' && (
          <div className={styles.result} aria-label="导入结果">
            <p>
              已导入 {importState.result.created} 个条目（其中附件 {importState.result.attachments} 个）到「
              {importState.result.folderName}」
              {importState.result.renamed > 0 && `，${importState.result.renamed} 个因重名加了序号`}。
            </p>
            {[...importState.result.warnings, ...importState.result.failed.map((f) => `${f.key}：${f.error}`)].length > 0 && (
              <ul className={styles.warnings}>
                {importState.result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
                {importState.result.failed.map((failure) => (
                  <li key={failure.key}>
                    导入失败 {failure.key}：{failure.error}
                  </li>
                ))}
              </ul>
            )}
            <button className={`${settingsStyles.actionButton} ${settingsStyles.testBtn}`} onClick={() => setImportState({ phase: 'idle' })}>
              <span>继续导入</span>
            </button>
          </div>
        )}
      </div>

      <div className={settingsStyles.section}>
        <h3 className={settingsStyles.sectionTitle}>导出</h3>
        <p className={settingsStyles.sectionDescription}>
          Markdown：按文件夹写出 .md（头部记录标签、时间、来源与摘要）与附件，可直接作为 Obsidian 库打开。JSON：完整字段 + 附件，可在其他设备或知识库中用“本应用 JSON”导入还原。
        </p>
        {exportState.phase === 'running' ? (
          <Progress done={exportState.done} total={exportState.total} label="正在导出" />
        ) : (
          <div className={styles.actions}>
            <button className={`${settingsStyles.actionButton} ${settingsStyles.testBtn}`} disabled={busy} onClick={() => void startExport('markdown')}>
              <Download size={14} />
              <span>导出为 Markdown…</span>
            </button>
            <button className={`${settingsStyles.actionButton} ${settingsStyles.testBtn}`} disabled={busy} onClick={() => void startExport('json')}>
              <Download size={14} />
              <span>导出为 JSON…</span>
            </button>
          </div>
        )}
        {exportState.phase === 'done' && (
          <div className={styles.result} aria-label="导出结果">
            <p>
              已导出 {exportState.result.items} 个条目（{exportState.result.files} 个文件）到 {exportState.result.path}
            </p>
            {exportState.result.failed.length > 0 && (
              <ul className={styles.warnings}>
                {exportState.result.failed.map((failure) => (
                  <li key={failure.title}>
                    {failure.title}：{failure.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className={settingsStyles.section}>
        <h3 className={settingsStyles.sectionTitle}>备份与恢复</h3>
        <p className={settingsStyles.sectionDescription}>
          数据库备份保存在当前知识库的 backups 目录，恢复前会先把当前数据另存一份。完整备份另外包含附件与文字识别结果，可在另一台设备上恢复。
        </p>
        <div className={styles.actions}>
          <button className={`${settingsStyles.actionButton} ${settingsStyles.saveBtn}`} disabled={busy || running} onClick={() => void createBackup()}>
            <DatabaseBackup size={14} />
            <span>立即备份</span>
          </button>
          <button className={`${settingsStyles.actionButton} ${settingsStyles.testBtn}`} disabled={busy || running} onClick={() => void exportFull()}>
            <Archive size={14} />
            <span>完整备份到文件夹…</span>
          </button>
          <button
            className={`${settingsStyles.actionButton} ${settingsStyles.testBtn}`}
            disabled={busy || running}
            onClick={() => void run(async () => void (await window.electron.backup.restoreFull()))}
          >
            <RotateCcw size={14} />
            <span>从完整备份恢复…</span>
          </button>
          <button
            className={`${settingsStyles.actionButton} ${settingsStyles.testBtn}`}
            disabled={busy || running}
            onClick={() => void run(async () => void (await window.electron.backup.restoreFromFile()))}
          >
            <RotateCcw size={14} />
            <span>从 .db 文件恢复…</span>
          </button>
          <button className={`${settingsStyles.actionButton} ${settingsStyles.testBtn}`} onClick={() => void run(() => window.electron.backup.openFolder())}>
            <FolderOpen size={14} />
            <span>打开备份目录</span>
          </button>
        </div>
        {backups.length === 0 ? (
          <p className={settingsStyles.sectionDescription}>还没有备份</p>
        ) : (
          <ul className={styles.backupList} aria-label="备份列表">
            {backups.map((backup) => (
              <li key={backup.fileName} className={styles.backupRow}>
                <span className={styles.backupName} title={backup.path}>
                  {backup.fileName}
                </span>
                <span className={styles.backupMeta}>
                  {new Date(backup.createdAt).toLocaleString('zh-CN', { hour12: false })} · {formatSize(backup.size)}
                </span>
                <button
                  className={styles.iconButton}
                  disabled={busy || running}
                  title="用此备份恢复"
                  aria-label={`恢复 ${backup.fileName}`}
                  onClick={() => void run(async () => void (await window.electron.backup.restore(backup.fileName)))}
                >
                  <RotateCcw size={13} />
                </button>
                <button
                  className={styles.iconButton}
                  disabled={busy || running}
                  title="删除此备份"
                  aria-label={`删除 ${backup.fileName}`}
                  onClick={() => setDeleting(backup)}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!deleting}
        title="删除备份"
        message={deleting ? `确定删除备份「${deleting.fileName}」吗？删除后无法恢复。` : ''}
        isDanger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
};

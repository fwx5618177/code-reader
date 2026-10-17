// ================================
// 待审阅归类面板：自动归类生成的提议逐条接受 / 修改后接受 / 拒绝，或全部接受、全部拒绝
// 接受时通过知识库服务应用（见 lib/categorization/review-actions），完成后重新加载知识库
// ================================

import React, { useMemo, useState } from 'react';
import { AlertCircle, Check, ClipboardCheck, Merge, Pencil, X } from 'lucide-react';
import type { CategorizationProposal, ItemCategorizationProposal } from '../../types/electron';
import type { UseKnowledgeBaseReturn } from '../../lib/knowledge/useKnowledgeBase';
import { listFolderPaths } from '../../lib/folders/types';
import { displayTitle } from '../../lib/links/link-index';
import { proposalEdit, type ItemProposalEdit } from '../../lib/categorization/acceptance';
import type { ReviewRequest } from '../../lib/categorization/review-actions';
import { categorizationReview, useCategorizationReview } from '../../lib/categorization/reviewStore';
import styles from './CategorizationReview.module.scss';

export interface CategorizationReviewProps {
  kb: UseKnowledgeBaseReturn;
  onSelectItem: (id: string) => void;
}

/** 文件夹下拉框中「新建文件夹」选项的值 */
const NEW_FOLDER = '__new__';

interface EditDraft {
  /** '' 为不移动，NEW_FOLDER 为新建顶层文件夹，其余为文件夹 ID */
  folder: string;
  newFolderName: string;
  /** 逗号分隔的标签 */
  tags: string;
}

function toDraft(proposal: ItemCategorizationProposal): EditDraft {
  const edit = proposalEdit(proposal);
  return {
    folder: !edit.folder ? '' : 'id' in edit.folder ? edit.folder.id : NEW_FOLDER,
    newFolderName: edit.folder && 'newName' in edit.folder ? edit.folder.newName : '',
    tags: edit.tags.join('，'),
  };
}

function fromDraft(draft: EditDraft): ItemProposalEdit {
  let folder: ItemProposalEdit['folder'] = null;
  if (draft.folder === NEW_FOLDER) folder = { newName: draft.newFolderName };
  else if (draft.folder) folder = { id: draft.folder };
  return { folder, tags: draft.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) };
}

const formatConfidence = (confidence: number | null) =>
  confidence === null ? null : `${Math.round(confidence * 100)}%`;

export const CategorizationReview: React.FC<CategorizationReviewProps> = ({ kb, onSelectItem }) => {
  const { proposals, loaded, error, busy } = useCategorizationReview();
  const [drafts, setDrafts] = useState<Map<string, EditDraft>>(new Map());
  const [failures, setFailures] = useState<Map<string, string>>(new Map());
  const [actionError, setActionError] = useState<string | null>(null);

  const folderPaths = useMemo(() => listFolderPaths(kb.folders), [kb.folders]);
  const pathById = useMemo(() => new Map(folderPaths.map((folder) => [folder.id, folder.path])), [folderPaths]);

  const setDraft = (id: string, draft: EditDraft | null) =>
    setDrafts((prev) => {
      const next = new Map(prev);
      if (draft) next.set(id, draft);
      else next.delete(id);
      return next;
    });

  const submit = async (requests: ReviewRequest[]) => {
    if (requests.length === 0) return;
    setActionError(null);
    const requested = new Set(requests.map((request) => request.proposal.id));
    try {
      const report = await categorizationReview.review(requests);
      const failed = new Map(report.failures.map((failure) => [failure.proposalId, failure.message]));
      // 只更新本次提交的提议：成功的清除修改草稿，失败的保留草稿并显示原因
      setFailures((prev) => new Map([...[...prev].filter(([id]) => !requested.has(id)), ...failed]));
      setDrafts((prev) => new Map([...prev].filter(([id]) => !requested.has(id) || failed.has(id))));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      await kb.reload();
    }
  };

  const accept = (proposal: CategorizationProposal) => {
    const draft = proposal.kind === 'item' ? drafts.get(proposal.id) : undefined;
    void submit([{ proposal, accept: true, edit: draft ? fromDraft(draft) : undefined }]);
  };
  const reject = (proposal: CategorizationProposal) => void submit([{ proposal, accept: false }]);
  const acceptAll = () => {
    const requests = proposals.map((proposal): ReviewRequest => {
      const draft = proposal.kind === 'item' ? drafts.get(proposal.id) : undefined;
      return { proposal, accept: true, edit: draft ? fromDraft(draft) : undefined };
    });
    void submit(requests);
  };
  const rejectAll = () => void submit(proposals.map((proposal) => ({ proposal, accept: false })));

  const close = () => categorizationReview.close();

  const folderLabel = (proposal: ItemCategorizationProposal) => {
    if (proposal.folderId) {
      const path = pathById.get(proposal.folderId);
      return path ? `移入「${path}」` : `移入「${proposal.folderName}」（文件夹已不存在）`;
    }
    return proposal.folderName ? `移入新建文件夹「${proposal.folderName}」` : null;
  };

  const renderEditor = (proposal: ItemCategorizationProposal, draft: EditDraft) => (
    <div className={styles.editor}>
      <label className={styles.field}>
        <span>文件夹</span>
        <select
          className={styles.select}
          aria-label="目标文件夹"
          value={draft.folder}
          onChange={(event) => setDraft(proposal.id, { ...draft, folder: event.target.value })}
        >
          <option value="">不移动</option>
          {folderPaths.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.path}
            </option>
          ))}
          <option value={NEW_FOLDER}>新建顶层文件夹…</option>
        </select>
      </label>
      {draft.folder === NEW_FOLDER && (
        <label className={styles.field}>
          <span>名称</span>
          <input
            className={styles.input}
            aria-label="新文件夹名称"
            value={draft.newFolderName}
            onChange={(event) => setDraft(proposal.id, { ...draft, newFolderName: event.target.value })}
          />
        </label>
      )}
      <label className={styles.field}>
        <span>追加标签</span>
        <input
          className={styles.input}
          aria-label="追加标签"
          placeholder="用逗号分隔"
          value={draft.tags}
          onChange={(event) => setDraft(proposal.id, { ...draft, tags: event.target.value })}
        />
      </label>
    </div>
  );

  const renderRow = (proposal: CategorizationProposal) => {
    const confidence = formatConfidence(proposal.confidence);
    const draft = proposal.kind === 'item' ? drafts.get(proposal.id) : undefined;
    const failure = failures.get(proposal.id);
    return (
      <li key={proposal.id} className={styles.row}>
        <div className={styles.rowMain}>
          {proposal.kind === 'tag-merge' ? (
            <div className={styles.summary}>
              <span className={styles.kind}>
                <Merge size={12} />
                合并标签
              </span>
              <span className={styles.change}>
                #{proposal.sourceTagName} → #{proposal.targetTagName}
              </span>
            </div>
          ) : (
            <div className={styles.summary}>
              <button
                type="button"
                className={styles.itemTitle}
                title="在知识库中选中该条目"
                onClick={() => onSelectItem(proposal.itemId)}
              >
                {displayTitle(proposal.itemTitle) || '未命名条目'}
              </button>
              {!draft && (
                <span className={styles.change}>
                  {[folderLabel(proposal), proposal.tags.length > 0 ? proposal.tags.map((tag) => `+#${tag}`).join(' ') : null]
                    .filter(Boolean)
                    .join('，')}
                </span>
              )}
            </div>
          )}
          {confidence && (
            <span className={styles.confidence} title="置信度">
              {confidence}
            </span>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.acceptButton}
              disabled={busy}
              title={draft ? '按修改后的目标接受' : '接受'}
              onClick={() => accept(proposal)}
            >
              <Check size={12} />
              {draft ? '确认接受' : '接受'}
            </button>
            {proposal.kind === 'item' && (
              <button
                type="button"
                className={styles.button}
                disabled={busy}
                aria-pressed={!!draft}
                onClick={() => setDraft(proposal.id, draft ? null : toDraft(proposal))}
              >
                <Pencil size={12} />
                {draft ? '取消修改' : '修改'}
              </button>
            )}
            <button type="button" className={styles.button} disabled={busy} onClick={() => reject(proposal)}>
              <X size={12} />
              拒绝
            </button>
          </div>
        </div>
        {proposal.kind === 'item' && draft && renderEditor(proposal, draft)}
        {proposal.reason && <p className={styles.reason}>{proposal.reason}</p>}
        {failure && (
          <p className={styles.error} role="alert">
            <AlertCircle size={12} />
            {failure}
          </p>
        )}
      </li>
    );
  };

  return (
    <div className={styles.overlay} onClick={close}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="待审阅归类"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
      >
        <header className={styles.header}>
          <h3>
            <ClipboardCheck size={15} />
            待审阅归类 <span className={styles.total}>{proposals.length}</span>
          </h3>
          <button type="button" className={styles.iconButton} title="关闭" onClick={close}>
            <X size={16} />
          </button>
        </header>
        <p className={styles.hint}>AI 的归类建议只有在接受后才会应用；接受只会追加标签，不会移除条目已有的标签。</p>

        {(error || actionError) && (
          <p className={styles.error} role="alert">
            <AlertCircle size={13} />
            {actionError ? `操作失败：${actionError}` : `加载失败：${error}`}
          </p>
        )}

        {!loaded ? (
          <p className={styles.empty}>正在加载…</p>
        ) : proposals.length === 0 ? (
          <p className={styles.empty}>没有待审阅的归类建议。可在工具栏点击「自动归类」生成。</p>
        ) : (
          <ul className={styles.list}>{proposals.map(renderRow)}</ul>
        )}

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.button}
            disabled={busy || proposals.length === 0}
            onClick={rejectAll}
          >
            全部拒绝
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={busy || proposals.length === 0}
            onClick={acceptAll}
          >
            <Check size={13} />
            {busy ? '正在应用…' : '全部接受'}
          </button>
        </footer>
      </div>
    </div>
  );
};

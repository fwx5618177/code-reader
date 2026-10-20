// ================================
// 自动归类提议的审阅：IPC 参数校验与状态流转（纯函数，由 categorization-ipc-handlers.ts 使用）
// 只有待审阅（pending）的提议可以被接受或拒绝；接受条目提议时可以带上用户修改后的目标
// ================================

import { normalizeTagList } from './categorize';
import { isRecord, normalizeText } from './json-output';

export type ProposalKind = 'item' | 'tag-merge';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected';

/** 实际应用到条目的归类（folderId 为空且 folderName 非空表示新建的顶层文件夹，两者皆空表示未移动） */
export interface AppliedItemCategorization {
  folderId: string | null;
  folderName: string | null;
  tags: string[];
}

export interface ReviewDecision {
  id: string;
  status: 'accepted' | 'rejected';
  /** 只用于接受条目提议；缺省时按原提议记录 */
  applied?: AppliedItemCategorization;
}

export interface StoredProposal extends AppliedItemCategorization {
  kind: ProposalKind;
  status: ProposalStatus;
}

export interface ReviewOutcome extends AppliedItemCategorization {
  status: 'accepted' | 'rejected';
}

const optionalString = (value: unknown, field: string): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`审阅参数 ${field} 必须是字符串`);
  return value;
};

/** 校验渲染进程传入的审阅决定 */
export function parseReviewDecisions(value: unknown): ReviewDecision[] {
  if (!Array.isArray(value)) throw new Error('审阅参数必须是数组');
  return value.map((entry): ReviewDecision => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) {
      throw new Error('审阅参数缺少提议 ID');
    }
    if (entry.status !== 'accepted' && entry.status !== 'rejected') {
      throw new Error(`未知的审阅结果：${String(entry.status)}`);
    }
    if (entry.applied === undefined) return { id: entry.id, status: entry.status };
    if (!isRecord(entry.applied) || !Array.isArray(entry.applied.tags)) {
      throw new Error('审阅参数 applied 格式不正确');
    }
    return {
      id: entry.id,
      status: entry.status,
      applied: {
        folderId: optionalString(entry.applied.folderId, 'folderId'),
        folderName: optionalString(entry.applied.folderName, 'folderName'),
        tags: entry.applied.tags.map((tag) => {
          if (typeof tag !== 'string') throw new Error('审阅参数 tags 只能包含字符串');
          return tag;
        }),
      },
    };
  });
}

/**
 * 计算审阅后的提议状态与记录的归类：
 * - 只有 pending 可以流转到 accepted / rejected，重复审阅报错
 * - 拒绝不能附带修改；只有条目提议可以修改后接受
 * - 修改后的标签按比较键去重，接受时必须至少移动文件夹或追加一个标签
 */
export function resolveReviewDecision(proposal: StoredProposal, decision: ReviewDecision): ReviewOutcome {
  if (proposal.status !== 'pending') throw new Error('该建议已审阅过');
  const original = { folderId: proposal.folderId, folderName: proposal.folderName, tags: proposal.tags };
  if (decision.status === 'rejected') {
    if (decision.applied) throw new Error('拒绝建议时不能附带修改');
    return { status: 'rejected', ...original };
  }
  if (!decision.applied) return { status: 'accepted', ...original };
  if (proposal.kind !== 'item') throw new Error('只有条目归类建议可以修改后接受');

  const folderName = decision.applied.folderName ? normalizeText(decision.applied.folderName) : '';
  const folderId = decision.applied.folderId || null;
  if (folderId && !folderName) throw new Error('目标文件夹缺少名称');
  const tags = normalizeTagList(decision.applied.tags, Number.POSITIVE_INFINITY);
  if (!folderName && tags.length === 0) throw new Error('接受的建议没有任何改动，请改为拒绝');
  return { status: 'accepted', folderId, folderName: folderName || null, tags };
}

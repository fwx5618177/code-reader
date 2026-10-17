// ================================
// Categorization Proposal IPC Handlers
// 自动归类待审阅提议：列出待审阅提议、记录审阅结果
// 提议的实际应用（移动文件夹、打标签、合并标签）由渲染进程通过知识库服务完成，再调用 review 记录结果
// ================================

import { ipcMain } from 'electron';
import { getSQLiteService } from './sqlite';
import { parseJsonStringArray } from '../agent/json-output';
import {
  parseReviewDecisions,
  resolveReviewDecision,
  type ProposalKind,
  type ProposalStatus,
} from '../agent/categorization-review';

interface ProposalBase {
  id: string;
  reason: string | null;
  confidence: number | null;
  createdAt: string;
}

type CategorizationProposal =
  | (ProposalBase & {
      kind: 'item';
      itemId: string;
      itemTitle: string;
      folderId: string | null;
      folderName: string | null;
      tags: string[];
    })
  | (ProposalBase & {
      kind: 'tag-merge';
      sourceTagId: string;
      sourceTagName: string;
      targetTagId: string;
      targetTagName: string;
    });

interface PendingRow {
  id: string;
  kind: ProposalKind;
  item_id: string | null;
  item_title: string | null;
  folder_id: string | null;
  folder_name: string | null;
  tags: string;
  source_tag_id: string | null;
  source_tag_name: string | null;
  target_tag_id: string | null;
  target_tag_name: string | null;
  reason: string | null;
  confidence: number | null;
  created_at: string;
}

/** 待审阅提议：条目未删除、合并两端的标签仍存在；标签合并在前，其余按生成顺序 */
function listPending(): CategorizationProposal[] {
  const rows = getSQLiteService().all<PendingRow>(
    `SELECT p.id, p.kind, p.item_id, k.title AS item_title, p.folder_id, p.folder_name, p.tags,
            p.source_tag_id, s.name AS source_tag_name, p.target_tag_id, t.name AS target_tag_name,
            p.reason, p.confidence, p.created_at
     FROM categorization_proposals p
     LEFT JOIN knowledge_items k ON k.id = p.item_id
     LEFT JOIN tags s ON s.id = p.source_tag_id
     LEFT JOIN tags t ON t.id = p.target_tag_id
     WHERE p.status = 'pending'
       AND ((p.kind = 'item' AND k.is_deleted = 0)
         OR (p.kind = 'tag-merge' AND s.is_deleted = 0 AND t.is_deleted = 0))
     ORDER BY p.kind = 'tag-merge' DESC, p.rowid ASC`
  );
  return rows.map((row): CategorizationProposal => {
    const base = { id: row.id, reason: row.reason, confidence: row.confidence, createdAt: row.created_at };
    return row.kind === 'item'
      ? {
          ...base,
          kind: 'item',
          itemId: row.item_id!,
          itemTitle: row.item_title!,
          folderId: row.folder_id,
          folderName: row.folder_name,
          tags: parseJsonStringArray(row.tags),
        }
      : {
          ...base,
          kind: 'tag-merge',
          sourceTagId: row.source_tag_id!,
          sourceTagName: row.source_tag_name!,
          targetTagId: row.target_tag_id!,
          targetTagName: row.target_tag_name!,
        };
  });
}

/**
 * 记录审阅结果（同一事务）。提议已不存在时跳过：标签合并被接受后源标签已删除，
 * 提议随外键级联删除；条目被彻底删除时同理
 */
function review(value: unknown): void {
  const decisions = parseReviewDecisions(value);
  const sqlite = getSQLiteService();
  sqlite.transaction(() => {
    const now = new Date().toISOString();
    for (const decision of decisions) {
      const row = sqlite.get<{
        kind: ProposalKind;
        status: ProposalStatus;
        folder_id: string | null;
        folder_name: string | null;
        tags: string;
      }>(`SELECT kind, status, folder_id, folder_name, tags FROM categorization_proposals WHERE id = ?`, [decision.id]);
      if (!row) continue;
      const outcome = resolveReviewDecision(
        {
          kind: row.kind,
          status: row.status,
          folderId: row.folder_id,
          folderName: row.folder_name,
          tags: parseJsonStringArray(row.tags),
        },
        decision
      );
      sqlite.run(
        `UPDATE categorization_proposals
         SET status = ?, folder_id = ?, folder_name = ?, tags = ?, reviewed_at = ?
         WHERE id = ? AND status = 'pending'`,
        [outcome.status, outcome.folderId, outcome.folderName, JSON.stringify(outcome.tags), now, decision.id]
      );
    }
  });
}

export function registerCategorizationHandlers(): void {
  ipcMain.handle('categorization:listPending', async (): Promise<CategorizationProposal[]> => {
    try {
      return listPending();
    } catch (error) {
      console.error('[Categorization:IPC] List pending error:', error);
      throw error;
    }
  });

  ipcMain.handle('categorization:review', async (_event, decisions: unknown): Promise<void> => {
    try {
      review(decisions);
    } catch (error) {
      console.error('[Categorization:IPC] Review error:', error);
      throw error;
    }
  });

  console.log('[Categorization:IPC] Categorization handlers registered');
}

export function cleanupCategorizationHandlers(): void {
  ipcMain.removeHandler('categorization:listPending');
  ipcMain.removeHandler('categorization:review');
  console.log('[Categorization:IPC] Categorization handlers cleaned up');
}

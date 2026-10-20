// ================================
// 执行归类审阅：接受的提议通过现有的知识库服务应用（合并标签、新建文件夹、移动条目、设置标签），
// 再把审阅结果记录到主进程。逐条应用，单条失败不影响其余提议
// ================================

import type {
  CategorizationProposal,
  CategorizationReviewDecision,
  ItemCategorizationProposal,
} from '../../types/electron';
import { folderRepository } from '../folders/repository';
import { folderService } from '../folders/service';
import { knowledgeRepository } from '../knowledge/repository';
import { writeTagsToFrontMatter } from '../knowledge/front-matter-tags';
import { planItemAcceptance, type AcceptanceContext, type ItemProposalEdit } from './acceptance';

export interface ReviewRequest {
  proposal: CategorizationProposal;
  accept: boolean;
  /** 修改后接受（只用于条目提议） */
  edit?: ItemProposalEdit;
}

export interface ReviewReport {
  /** 已记录审阅结果的提议数 */
  reviewed: number;
  failures: Array<{ proposalId: string; message: string }>;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function loadContext(): Promise<AcceptanceContext> {
  const [items, tags, folders] = await Promise.all([
    knowledgeRepository.listAll(),
    knowledgeRepository.listTags(),
    folderRepository.getAll(),
  ]);
  return { items: new Map(items.map((item) => [item.id, item])), tags, folders };
}

export async function applyReview(requests: ReviewRequest[]): Promise<ReviewReport> {
  const decisions: CategorizationReviewDecision[] = [];
  const failures: ReviewReport['failures'] = [];
  const itemAccepts: Array<{ proposal: ItemCategorizationProposal; edit?: ItemProposalEdit }> = [];
  /** 标签变了的条目：最后把笔记的 YAML 标签一并改写 */
  const retagged = new Set<string>();

  for (const { proposal, accept, edit } of requests) {
    if (!accept) decisions.push({ id: proposal.id, status: 'rejected' });
    else if (proposal.kind === 'item') itemAccepts.push({ proposal, edit });
    else {
      // 先合并标签：条目提议中的标签名已按合并后的标签给出
      try {
        const affected = await knowledgeRepository.itemIdsWithTags([proposal.sourceTagId]);
        await knowledgeRepository.mergeTags([proposal.sourceTagId], proposal.targetTagId);
        affected.forEach((id) => retagged.add(id));
        decisions.push({ id: proposal.id, status: 'accepted' });
      } catch (error) {
        failures.push({ proposalId: proposal.id, message: errorMessage(error) });
      }
    }
  }

  if (itemAccepts.length > 0) {
    // 标签合并之后再读取最新的条目 / 标签 / 文件夹
    const context = await loadContext();
    const createdFolders = new Map<string, string>();
    for (const { proposal, edit } of itemAccepts) {
      try {
        const plan = planItemAcceptance(proposal, edit ?? null, context);
        let folderId = plan.applied.folderId;
        if (plan.move) {
          if ('newFolderName' in plan.move) {
            const key = plan.move.newFolderName.toLowerCase();
            folderId =
              createdFolders.get(key) ??
              (await folderService.createFolder({ name: plan.move.newFolderName, parentId: null })).id;
            createdFolders.set(key, folderId);
          } else {
            folderId = plan.move.folderId;
          }
          await knowledgeRepository.update(proposal.itemId, { folderId });
        }
        if (plan.nextTags) {
          await knowledgeRepository.setItemTags(proposal.itemId, plan.nextTags);
          retagged.add(proposal.itemId);
        }
        decisions.push({ id: proposal.id, status: 'accepted', applied: { ...plan.applied, folderId } });
      } catch (error) {
        failures.push({ proposalId: proposal.id, message: errorMessage(error) });
      }
    }
  }

  await writeTagsToFrontMatter([...retagged]);
  if (decisions.length > 0) await window.electron.categorization.review(decisions);
  return { reviewed: decisions.length, failures };
}

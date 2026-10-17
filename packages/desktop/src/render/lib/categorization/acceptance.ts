// ================================
// 归类提议的接受规划（纯函数）：把条目提议（或用户修改后的目标）对照知识库当前状态，
// 算出需要执行的操作——移入哪个文件夹（已有 / 新建顶层）、条目最终的标签列表，以及记录到提议的实际归类
// ================================

import type { AppliedItemCategorization, ItemCategorizationProposal } from '../../types/electron';
import type { KnowledgeItem, Tag } from '../../types/knowledge';
import { listFolderPaths, type Folder } from '../folders/types';

/** 审阅面板中对条目提议的修改 */
export interface ItemProposalEdit {
  /** 目标文件夹：已有文件夹 ID，或新建顶层文件夹的名称；null 表示不移动 */
  folder: { id: string } | { newName: string } | null;
  tags: string[];
}

export interface AcceptanceContext {
  items: ReadonlyMap<string, Pick<KnowledgeItem, 'folderId' | 'tagIds'>>;
  tags: Tag[];
  folders: Folder[];
}

export interface ItemAcceptancePlan {
  /** 需要执行的移动；条目已在目标文件夹中或不移动时为 null */
  move: { folderId: string } | { newFolderName: string } | null;
  /** 应用后条目的完整标签列表（保留已有标签）；没有新增标签时为 null */
  nextTags: string[] | null;
  /** 记录到提议的实际归类；新建文件夹的 folderId 在创建后由调用方补上 */
  applied: AppliedItemCategorization;
}

/** 名称比较键：忽略首尾空白与大小写 */
const nameKey = (name: string) => name.trim().toLowerCase();

/** 提议的原始目标，作为编辑表单的初始值 */
export function proposalEdit(proposal: ItemCategorizationProposal): ItemProposalEdit {
  let folder: ItemProposalEdit['folder'] = null;
  if (proposal.folderId) folder = { id: proposal.folderId };
  else if (proposal.folderName) folder = { newName: proposal.folderName };
  return { folder, tags: proposal.tags };
}

/**
 * 规划接受一条条目提议；条目已删除、目标文件夹已不存在、没有任何改动时抛出错误（错误信息直接展示给用户）
 * - 新建文件夹名称与已有顶层文件夹同名（忽略大小写）时直接使用该文件夹
 * - 标签名与已有标签同名（忽略大小写）时使用已有标签的写法；只追加，不移除条目已有标签
 */
export function planItemAcceptance(
  proposal: ItemCategorizationProposal,
  edit: ItemProposalEdit | null,
  context: AcceptanceContext
): ItemAcceptancePlan {
  const item = context.items.get(proposal.itemId);
  if (!item) throw new Error('条目已被删除');
  const target = edit ?? proposalEdit(proposal);

  let move: ItemAcceptancePlan['move'] = null;
  let folderId: string | null = null;
  let folderName: string | null = null;
  if (target.folder) {
    const newName = 'newName' in target.folder ? target.folder.newName.trim() : null;
    const existingId =
      'id' in target.folder
        ? target.folder.id
        : context.folders.find((folder) => folder.parentId === null && nameKey(folder.name) === nameKey(newName!))?.id;
    if (newName === '') throw new Error('新文件夹名称不能为空');
    if (existingId) {
      const path = listFolderPaths(context.folders).find((folder) => folder.id === existingId)?.path;
      if (!path) throw new Error('目标文件夹已不存在，请修改后接受');
      folderId = existingId;
      folderName = path;
      if (existingId !== item.folderId) move = { folderId: existingId };
    } else {
      folderName = newName;
      move = { newFolderName: newName! };
    }
  }

  const tagNameByKey = new Map(context.tags.map((tag) => [nameKey(tag.name), tag.name]));
  const tags: string[] = [];
  for (const raw of target.tags) {
    const key = nameKey(raw);
    if (!key || tags.some((name) => nameKey(name) === key)) continue;
    tags.push(tagNameByKey.get(key) ?? raw.trim());
  }
  if (folderName === null && tags.length === 0) {
    throw new Error('请选择文件夹或添加标签，否则请拒绝该建议');
  }

  const tagNameById = new Map(context.tags.map((tag) => [tag.id, tag.name]));
  const current = item.tagIds.flatMap((id) => {
    const name = tagNameById.get(id);
    return name ? [name] : [];
  });
  const currentKeys = new Set(current.map(nameKey));
  const added = tags.filter((name) => !currentKeys.has(nameKey(name)));

  return {
    move,
    nextTags: added.length > 0 ? [...current, ...added] : null,
    applied: { folderId, folderName, tags },
  };
}

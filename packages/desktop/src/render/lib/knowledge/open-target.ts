// ================================
// 条目打开方式：从搜索、链接、知识库等入口打开条目时进入哪个模式
// 写作文档进入写作模式；文档附件（PDF / EPUB 等）进入阅读模式；其余在知识库详情中查看
// ================================

import type { KnowledgeItem } from '../../types/knowledge';
import { isWritingDocument } from '../documents/constants';
import { resolveArticle, resolveAttachmentKind } from '../reading';

export type ItemOpenTarget = 'writing' | 'reading' | 'knowledge';

type ItemShape = Pick<KnowledgeItem, 'type' | 'title' | 'content' | 'filePath' | 'mimeType'>;

/**
 * 能否在阅读模式中阅读：PDF / EPUB 附件、文档、网页剪藏，以及有正文的非写作条目
 * 写作文档在写作模式中编辑，不算可阅读条目
 */
export function isReadableItem(item: ItemShape): boolean {
  if (isWritingDocument(item)) return false;
  if (item.type === 'document' || item.type === 'webpage') return true;
  const kind = resolveAttachmentKind(item);
  return kind === 'pdf' || kind === 'epub' || resolveArticle(item) !== null;
}

/** 打开条目时进入的模式 */
export function itemOpenTarget(item: Pick<KnowledgeItem, 'type'>): ItemOpenTarget {
  if (isWritingDocument(item)) return 'writing';
  if (item.type === 'document') return 'reading';
  return 'knowledge';
}

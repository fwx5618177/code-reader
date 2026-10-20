// ================================
// 应用远端同步修改后的界面刷新
// 知识库与写作列表整体重新加载；正在编辑的文档在没有未保存修改时换成同步后的内容（不触发保存写回），
// 被远端删除的文档销毁其编辑实例，残留的编辑不会再写入
// ================================

import { getEditorManager } from '../core';
import { documentService } from '../documents';
import { notifyKnowledgeChanged } from '../knowledge/changes';

export async function refreshAfterSync(itemIds: readonly string[]): Promise<void> {
  const manager = getEditorManager();
  for (const id of itemIds) {
    if (!manager.has(id)) continue;
    const document = await documentService.getDocument(id);
    if (document) manager.reloadFromStorage(id, document.title, document.content);
    else manager.forceDestroy(id);
  }
  notifyKnowledgeChanged();
}

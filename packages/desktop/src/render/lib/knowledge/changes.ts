// ================================
// 知识库整体变化通知：批量导入等一次性写入大量条目的操作完成后发出，
// 知识库与写作文档列表据此整体重新加载（单个条目的变化走 agentActivity.onItemChanged）
// ================================

const listeners = new Set<() => void>();

export function onKnowledgeChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyKnowledgeChanged(): void {
  for (const listener of listeners) listener();
}

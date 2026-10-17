// ================================
// Agent 记录 ID 生成（任务、标签、文件夹、实体等主进程写入的记录共用）
// ================================

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

// ================================
// Agent 任务类型
// 无依赖的独立模块：执行器与数据库表约束（agent_tasks.type CHECK）共用同一份定义
// ================================

export const TASK_TYPES = [
  'transcribe',
  'summarize',
  'extract-tags',
  'generate-embedding',
  'find-related',
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

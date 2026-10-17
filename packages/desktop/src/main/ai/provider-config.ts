// ================================
// AI 服务商配置类型
// 主进程 AI 配置的唯一定义，供 ai-service、IPC 与旧配置迁移共用
// ================================

export const AI_PROVIDER_TYPES = [
  'openai',
  'anthropic',
  'deepseek',
  'moonshot',
  'zhipu',
  'ollama',
] as const;

export type AIProviderType = (typeof AI_PROVIDER_TYPES)[number];

export function isAIProviderType(value: unknown): value is AIProviderType {
  return typeof value === 'string' && (AI_PROVIDER_TYPES as readonly string[]).includes(value);
}

export interface AIProviderConfig {
  id: string;
  type: AIProviderType;
  name: string;
  baseUrl?: string;
  apiKey?: string;
  isEnabled: boolean;
  /** 对话模型（摘要、标签、问答） */
  defaultModel?: string;
  /** 向量模型；为空表示该服务商不参与向量生成 */
  embeddingModel?: string;
  /** 语音转写模型（OpenAI 兼容 audio/transcriptions 接口）；为空表示不参与转写 */
  transcriptionModel?: string;
  settings?: Record<string, unknown>;
}

/** 新增服务商的输入，id 由主进程生成 */
export type AIProviderInput = Omit<AIProviderConfig, 'id'>;

/**
 * 服务商更新字段：
 * - 字段缺省（undefined）表示保持不变；
 * - apiKey 为空字符串同样保持原密钥，避免渲染进程回传占位值覆盖真实密钥；
 * - baseUrl / 模型字段为空字符串表示清除。
 */
export type AIProviderUpdate = Partial<Omit<AIProviderConfig, 'id' | 'type'>>;

/** 暴露给渲染进程的服务商视图，不包含密钥本身 */
export type AIProviderView = Omit<AIProviderConfig, 'apiKey'> & { hasApiKey: boolean };

/** 渲染进程读取的配置快照，默认服务商均为主进程实际会使用的生效值 */
export interface AIConfigSnapshot {
  providers: AIProviderView[];
  defaultProviderId?: string;
  defaultEmbeddingProviderId?: string;
  defaultTranscriptionProviderId?: string;
}

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

/** Ollama 的 OpenAI 兼容接口地址（原生 /api 接口与 OpenAI 协议不兼容） */
export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1';

/** 本地服务商不校验密钥，其余服务商必须配置 API Key */
export function providerRequiresApiKey(type: AIProviderType): boolean {
  return type !== 'ollama';
}

/**
 * 规范化服务商地址，写入配置与加载已有配置时调用：
 * Ollama 未填地址时使用本机默认地址，旧预设写入的原生接口 .../api 改写为 OpenAI 兼容的 .../v1；
 * 其他服务商原样返回（未填则由 SDK 使用官方地址）
 */
export function normalizeProviderBaseUrl(
  type: AIProviderType,
  baseUrl: string | undefined
): string | undefined {
  if (type !== 'ollama') return baseUrl;
  if (!baseUrl) return OLLAMA_DEFAULT_BASE_URL;
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? `${trimmed.slice(0, -'/api'.length)}/v1` : trimmed;
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
export type AIProviderView = Omit<AIProviderConfig, 'apiKey'> & {
  hasApiKey: boolean;
  /** 为 false 时未配置密钥也可使用（本地服务商） */
  requiresApiKey: boolean;
};

/** 渲染进程读取的配置快照，默认服务商均为主进程实际会使用的生效值 */
export interface AIConfigSnapshot {
  providers: AIProviderView[];
  defaultProviderId?: string;
  defaultEmbeddingProviderId?: string;
  defaultTranscriptionProviderId?: string;
}

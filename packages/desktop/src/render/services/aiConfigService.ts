// ================================
// AI 配置客户端
// 主进程（main/ai）是 AI 服务商配置的唯一数据源；本服务只通过 window.electron.ai IPC 读写，
// 不做文件读写、不直连服务商接口、不接触密钥明文，仅缓存最近一次的配置快照供同步读取与订阅。
// ================================

import {
  LLM_PROVIDER_PRESETS,
  TRANSCRIPTION_PROVIDER_PRESETS,
  type AIProviderType,
  type TranscriptionProviderType,
} from '../types/ai-providers';

// ================================
// 类型（由 preload 暴露的 IPC 接口推导，避免重复声明）
// ================================

type AIBridge = Window['electron']['ai'];

export type AIConfigSnapshot = Awaited<ReturnType<AIBridge['getConfig']>>;
export type AIProviderView = AIConfigSnapshot['providers'][number];
export type AIProviderInput = Parameters<AIBridge['addProvider']>[0];
export type AIProviderUpdate = Parameters<AIBridge['updateProvider']>[1];
export type AIConnectionTestResult = Awaited<ReturnType<AIBridge['testConnection']>>;

/** 新增服务商时按类型预填的字段 */
export type AIProviderDefaults = Pick<
  AIProviderInput,
  'name' | 'baseUrl' | 'defaultModel' | 'embeddingModel' | 'transcriptionModel'
>;

// ================================
// 常量
// ================================

/** 提供 OpenAI 兼容转写接口的服务商类型 → 对应的转写预设 */
const TRANSCRIPTION_PRESET_BY_PROVIDER: Partial<Record<AIProviderType, TranscriptionProviderType>> =
  {
    openai: 'openai-whisper',
  };

const EMPTY_SNAPSHOT: AIConfigSnapshot = { providers: [] };

// ================================
// AI 配置客户端
// ================================

class AIConfigService {
  private snapshot: AIConfigSnapshot = EMPTY_SNAPSHOT;
  private listeners = new Set<() => void>();

  /**
   * 启动时加载配置快照
   */
  async initialize(): Promise<void> {
    await this.refresh();
  }

  /**
   * 从主进程重新读取配置并通知订阅者
   */
  async refresh(): Promise<AIConfigSnapshot> {
    this.snapshot = await window.electron.ai.getConfig();
    this.listeners.forEach((listener) => listener());
    return this.snapshot;
  }

  /**
   * 最近一次读取的配置快照；引用在刷新前保持稳定，可直接用于 useSyncExternalStore
   */
  getSnapshot = (): AIConfigSnapshot => this.snapshot;

  /**
   * 订阅配置变化，返回取消订阅函数
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // ================================
  // 服务商管理
  // ================================

  async addProvider(input: AIProviderInput): Promise<AIProviderView> {
    return this.mutate(() => window.electron.ai.addProvider(input));
  }

  /**
   * 更新服务商；apiKey 缺省或为空时主进程保留已存储的密钥
   */
  async updateProvider(id: string, updates: AIProviderUpdate): Promise<AIProviderView> {
    return this.mutate(() => window.electron.ai.updateProvider(id, updates));
  }

  async removeProvider(id: string): Promise<void> {
    await this.mutate(() => window.electron.ai.removeProvider(id));
  }

  async setDefaultProvider(id: string): Promise<void> {
    await this.mutate(() => window.electron.ai.setDefaultProvider(id));
  }

  async setDefaultEmbeddingProvider(id: string): Promise<void> {
    await this.mutate(() => window.electron.ai.setDefaultEmbeddingProvider(id));
  }

  async setDefaultTranscriptionProvider(id: string): Promise<void> {
    await this.mutate(() => window.electron.ai.setDefaultTranscriptionProvider(id));
  }

  /**
   * 由主进程使用已保存的配置发起一次对话请求以验证连通性
   */
  testConnection(id: string): Promise<AIConnectionTestResult> {
    return window.electron.ai.testConnection(id);
  }

  /**
   * 是否存在可用的对话服务商（已启用的默认服务商且已配置密钥）
   */
  async hasUsableProvider(): Promise<boolean> {
    const { providers, defaultProviderId } = await this.refresh();
    return providers.some((p) => p.id === defaultProviderId && p.hasApiKey);
  }

  /**
   * 按服务商预设推导新增表单的默认值：对话模型取预设默认模型，
   * 向量模型取预设中首个向量模型，转写模型取对应转写预设的首个模型
   */
  getProviderDefaults(type: AIProviderType): AIProviderDefaults {
    const preset = LLM_PROVIDER_PRESETS.find((p) => p.type === type);
    const models = preset?.availableModels ?? [];
    const chatModels = models.filter((m) => m.capabilities.chat);
    const transcriptionType = TRANSCRIPTION_PRESET_BY_PROVIDER[type];
    const transcriptionPreset = transcriptionType
      ? TRANSCRIPTION_PROVIDER_PRESETS.find((p) => p.type === transcriptionType)
      : undefined;

    return {
      name: preset?.name ?? type,
      baseUrl: preset?.defaultBaseUrl,
      defaultModel: (chatModels.find((m) => m.isDefault) ?? chatModels[0])?.id,
      embeddingModel: models.find((m) => m.capabilities.embeddings)?.id,
      transcriptionModel: transcriptionPreset?.availableModels[0]?.id,
    };
  }

  /**
   * 执行写操作后刷新快照，保证订阅者看到主进程的最新状态
   */
  private async mutate<T>(action: () => Promise<T>): Promise<T> {
    const result = await action();
    await this.refresh();
    return result;
  }
}

// ================================
// Singleton Export
// ================================

export const aiConfigService = new AIConfigService();

export default aiConfigService;

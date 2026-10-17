// ================================
// AI Service
// Main process implementation for AI API calls
// Supports OpenAI, Anthropic, and other providers
// ================================

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { app } from 'electron';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { readLegacyAIConfig } from './legacy-config';
import {
  isAIProviderType,
  normalizeProviderBaseUrl,
  providerRequiresApiKey,
  type AIConfigSnapshot,
  type AIProviderConfig,
  type AIProviderInput,
  type AIProviderUpdate,
  type AIProviderView,
} from './provider-config';

// ================================
// Types
// ================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  providerId?: string;
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletionResponse {
  id: string;
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
  /** 流式对话被调用方停止；此时 content 为停止前已生成的部分 */
  aborted?: boolean;
}

export interface EmbeddingRequest {
  providerId?: string;
  model?: string;
  input: string | string[];
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
}

export interface SummarizeRequest {
  content: string;
  maxLength?: number;
  language?: string;
  providerId?: string;
}

export interface SummarizeResponse {
  summary: string;
  keyPoints: string[];
}

export interface ExtractTagsRequest {
  content: string;
  maxTags?: number;
  existingTags?: string[];
  providerId?: string;
}

export interface ExtractTagsResponse {
  tags: Array<{
    name: string;
    confidence: number;
  }>;
}

export interface TranscribeRequest {
  audioPath: string;
  language?: string;
  providerId?: string;
}

export interface TranscribeResponse {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  language?: string;
  duration?: number;
}

// ================================
// AI Configuration Manager
// ================================

interface AIConfigFile {
  version: number;
  providers: AIProviderConfig[];
  defaultProviderId?: string;
  defaultEmbeddingProviderId?: string;
  defaultTranscriptionProviderId?: string;
  updatedAt: string;
}

/** 去除首尾空白，空字符串视为未设置 */
function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function requireName(name: string | undefined): string {
  const normalized = normalizeOptional(name);
  if (!normalized) {
    throw new Error('Provider name is required');
  }
  return normalized;
}

/** 无需密钥的服务商仍要给 OpenAI SDK 一个非空值，否则 SDK 会在构造时报错 */
const LOCAL_API_KEY_PLACEHOLDER = 'local';

function assertApiKey(provider: AIProviderConfig): void {
  if (providerRequiresApiKey(provider.type) && !provider.apiKey) {
    throw new Error(`No API key configured for provider: ${provider.name}`);
  }
}

class AIConfigManager {
  private configPath: string;
  private config: AIConfigFile;

  constructor() {
    const userDataPath = app.getPath('userData');
    const configDir = join(userDataPath, 'config');

    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    this.configPath = join(configDir, 'ai-config.json');
    this.config = this.loadConfig();
    this.importLegacyConfig(userDataPath);
    this.normalizeStoredBaseUrls();
  }

  /**
   * 修正已保存的服务商地址（如旧版 Ollama 预设的 /api 地址），有变化时写回
   */
  private normalizeStoredBaseUrls(): void {
    let changed = false;
    this.config.providers = this.config.providers.map((provider) => {
      const baseUrl = normalizeProviderBaseUrl(provider.type, provider.baseUrl);
      if (baseUrl === provider.baseUrl) return provider;
      changed = true;
      return { ...provider, baseUrl };
    });
    if (changed) {
      this.saveConfig();
    }
  }

  /**
   * 一次性迁移：主配置尚无服务商时导入旧版渲染进程配置 <userData>/ai-config.json，
   * 导入并保存成功后将旧文件重命名为 ai-config.legacy.json，之后不再触发。
   */
  private importLegacyConfig(userDataPath: string): void {
    if (this.config.providers.length > 0) return;

    const legacyPath = join(userDataPath, 'ai-config.json');
    if (!existsSync(legacyPath)) return;

    try {
      const imported = readLegacyAIConfig(readFileSync(legacyPath, 'utf-8'));
      this.config.providers = imported.providers;
      this.config.defaultProviderId = imported.defaultProviderId;
      this.config.defaultTranscriptionProviderId = imported.defaultTranscriptionProviderId;
      this.saveConfig();
      renameSync(legacyPath, join(userDataPath, 'ai-config.legacy.json'));
      console.log(`[AIConfig] Imported ${imported.providers.length} provider(s) from legacy config`);
      if (imported.skipped.length > 0) {
        console.warn('[AIConfig] Skipped unsupported legacy providers:', imported.skipped);
      }
    } catch (error) {
      // 保留旧文件，下次启动重试，避免丢失用户配置
      console.error('[AIConfig] Failed to import legacy config:', error);
    }
  }

  private loadConfig(): AIConfigFile {
    try {
      if (existsSync(this.configPath)) {
        const content = readFileSync(this.configPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('[AIConfig] Failed to load config:', error);
    }

    // Return default config
    return {
      version: 1,
      providers: [],
      updatedAt: new Date().toISOString(),
    };
  }

  saveConfig(): void {
    try {
      this.config.updatedAt = new Date().toISOString();
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (error) {
      console.error('[AIConfig] Failed to save config:', error);
      throw error;
    }
  }

  getProviders(): AIProviderConfig[] {
    return this.config.providers;
  }

  getProvider(id: string): AIProviderConfig | undefined {
    return this.config.providers.find((p) => p.id === id);
  }

  getDefaultProvider(): AIProviderConfig | undefined {
    if (this.config.defaultProviderId) {
      const provider = this.getProvider(this.config.defaultProviderId);
      if (provider?.isEnabled) return provider;
    }
    return this.config.providers.find((p) => p.isEnabled);
  }

  getDefaultEmbeddingProvider(): AIProviderConfig | undefined {
    if (this.config.defaultEmbeddingProviderId) {
      const provider = this.getProvider(this.config.defaultEmbeddingProviderId);
      if (provider?.isEnabled && provider.embeddingModel) return provider;
    }
    // Fallback to any enabled provider with embedding support
    return this.config.providers.find((p) => p.isEnabled && p.embeddingModel);
  }

  getDefaultTranscriptionProvider(): AIProviderConfig | undefined {
    if (this.config.defaultTranscriptionProviderId) {
      const provider = this.getProvider(this.config.defaultTranscriptionProviderId);
      if (provider?.isEnabled && provider.transcriptionModel) return provider;
    }
    // 回退到任一启用且配置了转写模型的服务商
    return this.config.providers.find((p) => p.isEnabled && p.transcriptionModel);
  }

  addProvider(input: AIProviderInput): AIProviderConfig {
    if (!isAIProviderType(input.type)) {
      throw new Error(`Unsupported provider type: ${String(input.type)}`);
    }

    const provider: AIProviderConfig = {
      id: randomUUID(),
      type: input.type,
      name: requireName(input.name),
      baseUrl: normalizeProviderBaseUrl(input.type, normalizeOptional(input.baseUrl)),
      apiKey: normalizeOptional(input.apiKey),
      isEnabled: input.isEnabled,
      defaultModel: normalizeOptional(input.defaultModel),
      embeddingModel: normalizeOptional(input.embeddingModel),
      transcriptionModel: normalizeOptional(input.transcriptionModel),
      settings: input.settings,
    };

    this.config.providers.push(provider);
    this.saveConfig();
    return provider;
  }

  updateProvider(id: string, updates: AIProviderUpdate): AIProviderConfig {
    const index = this.config.providers.findIndex((p) => p.id === id);
    if (index < 0) {
      throw new Error(`Provider not found: ${id}`);
    }

    const current = this.config.providers[index];
    const optional = (key: 'baseUrl' | 'defaultModel' | 'embeddingModel' | 'transcriptionModel') =>
      updates[key] === undefined ? current[key] : normalizeOptional(updates[key]);

    const updated: AIProviderConfig = {
      ...current,
      name: updates.name === undefined ? current.name : requireName(updates.name),
      apiKey: normalizeOptional(updates.apiKey) ?? current.apiKey,
      isEnabled: updates.isEnabled ?? current.isEnabled,
      baseUrl: normalizeProviderBaseUrl(current.type, optional('baseUrl')),
      defaultModel: optional('defaultModel'),
      embeddingModel: optional('embeddingModel'),
      transcriptionModel: optional('transcriptionModel'),
      settings: updates.settings ?? current.settings,
    };

    this.config.providers[index] = updated;
    this.saveConfig();
    return updated;
  }

  removeProvider(id: string): void {
    this.config.providers = this.config.providers.filter((p) => p.id !== id);
    if (this.config.defaultProviderId === id) {
      this.config.defaultProviderId = undefined;
    }
    if (this.config.defaultEmbeddingProviderId === id) {
      this.config.defaultEmbeddingProviderId = undefined;
    }
    if (this.config.defaultTranscriptionProviderId === id) {
      this.config.defaultTranscriptionProviderId = undefined;
    }
    this.saveConfig();
  }

  setDefaultProvider(id: string): void {
    this.requireProvider(id);
    this.config.defaultProviderId = id;
    this.saveConfig();
  }

  setDefaultEmbeddingProvider(id: string): void {
    if (!this.requireProvider(id).embeddingModel) {
      throw new Error('Provider has no embedding model configured');
    }
    this.config.defaultEmbeddingProviderId = id;
    this.saveConfig();
  }

  setDefaultTranscriptionProvider(id: string): void {
    if (!this.requireProvider(id).transcriptionModel) {
      throw new Error('Provider has no transcription model configured');
    }
    this.config.defaultTranscriptionProviderId = id;
    this.saveConfig();
  }

  private requireProvider(id: string): AIProviderConfig {
    const provider = this.getProvider(id);
    if (!provider) {
      throw new Error(`Provider not found: ${id}`);
    }
    return provider;
  }
}

function toProviderView({ apiKey, ...rest }: AIProviderConfig): AIProviderView {
  return { ...rest, hasApiKey: Boolean(apiKey), requiresApiKey: providerRequiresApiKey(rest.type) };
}

// ================================
// AI Service Class
// ================================

export class AIService {
  private configManager: AIConfigManager;
  private openaiClients: Map<string, OpenAI> = new Map();
  private anthropicClients: Map<string, Anthropic> = new Map();

  constructor() {
    this.configManager = new AIConfigManager();
  }

  // ================================
  // Provider Management
  // ================================

  getConfigSnapshot(): AIConfigSnapshot {
    return {
      providers: this.configManager.getProviders().map(toProviderView),
      defaultProviderId: this.configManager.getDefaultProvider()?.id,
      defaultEmbeddingProviderId: this.configManager.getDefaultEmbeddingProvider()?.id,
      defaultTranscriptionProviderId: this.configManager.getDefaultTranscriptionProvider()?.id,
    };
  }

  addProvider(input: AIProviderInput): AIProviderView {
    return toProviderView(this.configManager.addProvider(input));
  }

  updateProvider(id: string, updates: AIProviderUpdate): AIProviderView {
    const provider = this.configManager.updateProvider(id, updates);
    // 密钥或地址可能变化，丢弃缓存的客户端
    this.openaiClients.delete(id);
    this.anthropicClients.delete(id);
    return toProviderView(provider);
  }

  removeProvider(id: string): void {
    this.configManager.removeProvider(id);
    this.openaiClients.delete(id);
    this.anthropicClients.delete(id);
  }

  setDefaultProvider(id: string): void {
    this.configManager.setDefaultProvider(id);
  }

  setDefaultEmbeddingProvider(id: string): void {
    this.configManager.setDefaultEmbeddingProvider(id);
  }

  setDefaultTranscriptionProvider(id: string): void {
    this.configManager.setDefaultTranscriptionProvider(id);
  }

  // ================================
  // Client Management
  // ================================

  private getOpenAIClient(provider: AIProviderConfig): OpenAI {
    let client = this.openaiClients.get(provider.id);
    if (!client) {
      client = new OpenAI({
        apiKey: provider.apiKey ?? LOCAL_API_KEY_PLACEHOLDER,
        baseURL: provider.baseUrl,
      });
      this.openaiClients.set(provider.id, client);
    }
    return client;
  }

  private getAnthropicClient(provider: AIProviderConfig): Anthropic {
    let client = this.anthropicClients.get(provider.id);
    if (!client) {
      client = new Anthropic({
        apiKey: provider.apiKey,
        baseURL: provider.baseUrl,
      });
      this.anthropicClients.set(provider.id, client);
    }
    return client;
  }

  // ================================
  // Chat Completion
  // ================================

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { provider, model } = this.resolveChatTarget(request);
    return provider.type === 'anthropic'
      ? this.anthropicChatCompletion(provider, request, model)
      : this.openaiChatCompletion(provider, request, model);
  }

  /**
   * 流式对话：每收到一段文本调用 onDelta，结束后返回完整结果
   * signal 中止后不视为失败，返回已生成的部分并标记 aborted
   */
  async chatCompletionStream(
    request: ChatCompletionRequest,
    onDelta: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<ChatCompletionResponse> {
    const { provider, model } = this.resolveChatTarget(request);
    let partial = '';
    const emit = (delta: string) => {
      partial += delta;
      onDelta(delta);
    };
    try {
      return provider.type === 'anthropic'
        ? await this.anthropicChatCompletionStream(provider, request, model, emit, signal)
        : await this.openaiChatCompletionStream(provider, request, model, emit, signal);
    } catch (error) {
      if (signal?.aborted) return { id: '', content: partial, model, aborted: true };
      throw error;
    }
  }

  /** 解析本次对话使用的服务商与模型；除 anthropic 外均走 OpenAI 兼容接口 */
  private resolveChatTarget(request: ChatCompletionRequest): {
    provider: AIProviderConfig;
    model: string;
  } {
    const provider = request.providerId
      ? this.configManager.getProvider(request.providerId)
      : this.configManager.getDefaultProvider();

    if (!provider) {
      throw new Error('No AI provider configured');
    }

    assertApiKey(provider);

    const model = request.model || provider.defaultModel;
    if (!model) {
      throw new Error('No model specified');
    }
    return { provider, model };
  }

  private openaiMessages(request: ChatCompletionRequest) {
    return request.messages.map((m) => ({ role: m.role, content: m.content }));
  }

  private async openaiChatCompletion(
    provider: AIProviderConfig,
    request: ChatCompletionRequest,
    model: string
  ): Promise<ChatCompletionResponse> {
    const client = this.getOpenAIClient(provider);

    const response = await client.chat.completions.create({
      model,
      messages: this.openaiMessages(request),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens,
    });

    const choice = response.choices[0];

    return {
      id: response.id,
      content: choice.message.content || '',
      model: response.model,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
      finishReason: choice.finish_reason || undefined,
    };
  }

  private async openaiChatCompletionStream(
    provider: AIProviderConfig,
    request: ChatCompletionRequest,
    model: string,
    onDelta: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<ChatCompletionResponse> {
    const client = this.getOpenAIClient(provider);

    const stream = await client.chat.completions.create(
      {
        model,
        messages: this.openaiMessages(request),
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens,
        stream: true,
      },
      { signal }
    );

    let id = '';
    let responseModel = model;
    let content = '';
    let finishReason: string | undefined;
    for await (const chunk of stream) {
      id = chunk.id || id;
      responseModel = chunk.model || responseModel;
      const choice = chunk.choices[0];
      const delta = choice?.delta?.content;
      if (delta) {
        content += delta;
        onDelta(delta);
      }
      finishReason = choice?.finish_reason || finishReason;
    }

    return { id, content, model: responseModel, finishReason };
  }

  private anthropicRequest(request: ChatCompletionRequest, model: string) {
    // system 消息在 Anthropic 接口中是独立参数
    const systemMessage = request.messages.find((m) => m.role === 'system');
    return {
      model,
      max_tokens: request.maxTokens || 4096,
      system: systemMessage?.content,
      messages: request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    };
  }

  private toAnthropicResponse(response: Anthropic.Message): ChatCompletionResponse {
    const textContent = response.content.find((c) => c.type === 'text');

    return {
      id: response.id,
      content: textContent && 'text' in textContent ? textContent.text : '',
      model: response.model,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: response.stop_reason || undefined,
    };
  }

  private async anthropicChatCompletion(
    provider: AIProviderConfig,
    request: ChatCompletionRequest,
    model: string
  ): Promise<ChatCompletionResponse> {
    const client = this.getAnthropicClient(provider);
    const response = await client.messages.create(this.anthropicRequest(request, model));
    return this.toAnthropicResponse(response);
  }

  private async anthropicChatCompletionStream(
    provider: AIProviderConfig,
    request: ChatCompletionRequest,
    model: string,
    onDelta: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<ChatCompletionResponse> {
    const client = this.getAnthropicClient(provider);
    const stream = client.messages.stream(this.anthropicRequest(request, model), { signal });
    stream.on('text', onDelta);
    return this.toAnthropicResponse(await stream.finalMessage());
  }

  // ================================
  // Embeddings
  // ================================

  async createEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const provider = request.providerId
      ? this.configManager.getProvider(request.providerId)
      : this.configManager.getDefaultEmbeddingProvider();

    if (!provider) {
      throw new Error('No embedding provider configured');
    }

    assertApiKey(provider);

    const model = request.model || provider.embeddingModel || 'text-embedding-3-small';

    // Currently only OpenAI-compatible APIs support embeddings
    const client = this.getOpenAIClient(provider);
    const inputs = Array.isArray(request.input) ? request.input : [request.input];

    const response = await client.embeddings.create({
      model,
      input: inputs,
    });

    const embeddings = response.data.map((d) => d.embedding);
    const dimensions = embeddings[0]?.length || 0;

    return {
      embeddings,
      model: response.model,
      dimensions,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  // ================================
  // Summarization
  // ================================

  async summarize(request: SummarizeRequest): Promise<SummarizeResponse> {
    const maxLength = request.maxLength || 300;
    const language = request.language || 'zh-CN';

    const systemPrompt = `你是一个专业的内容摘要助手。请根据用户提供的内容，生成简洁准确的摘要。

要求：
1. 摘要长度控制在${maxLength}字以内
2. 提取3-5个关键要点
3. 使用${language === 'zh-CN' ? '中文' : '英文'}输出
4. 返回JSON格式：{"summary": "摘要内容", "keyPoints": ["要点1", "要点2", ...]}

只返回JSON，不要有其他文字。`;

    const response = await this.chatCompletion({
      providerId: request.providerId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: request.content },
      ],
      temperature: 0.3,
    });

    try {
      // Try to parse JSON response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || '',
          keyPoints: parsed.keyPoints || [],
        };
      }
    } catch (error) {
      console.error('[AIService] Failed to parse summary response:', error);
    }

    // Fallback: return the raw content as summary
    return {
      summary: response.content.slice(0, maxLength),
      keyPoints: [],
    };
  }

  // ================================
  // Tag Extraction
  // ================================

  async extractTags(request: ExtractTagsRequest): Promise<ExtractTagsResponse> {
    const maxTags = request.maxTags || 5;
    const existingTags = request.existingTags || [];

    const systemPrompt = `你是一个专业的内容标签提取助手。请根据用户提供的内容，提取最相关的标签。

要求：
1. 最多提取${maxTags}个标签
2. 标签应该简短（1-3个词）
3. 优先使用已有标签列表中的标签：${existingTags.length > 0 ? existingTags.join(', ') : '（暂无已有标签）'}
4. 为每个标签评估置信度（0-1之间的小数）
5. 返回JSON格式：{"tags": [{"name": "标签名", "confidence": 0.9}, ...]}

只返回JSON，不要有其他文字。`;

    const response = await this.chatCompletion({
      providerId: request.providerId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: request.content },
      ],
      temperature: 0.3,
    });

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          tags: (parsed.tags || []).slice(0, maxTags),
        };
      }
    } catch (error) {
      console.error('[AIService] Failed to parse tags response:', error);
    }

    return { tags: [] };
  }

  // ================================
  // Transcription (OpenAI-compatible audio/transcriptions)
  // ================================

  async transcribe(request: TranscribeRequest): Promise<TranscribeResponse> {
    const provider = request.providerId
      ? this.configManager.getProvider(request.providerId)
      : this.configManager.getDefaultTranscriptionProvider();

    if (!provider) {
      throw new Error('No transcription provider configured');
    }

    assertApiKey(provider);

    if (!provider.transcriptionModel) {
      throw new Error(`No transcription model configured for provider: ${provider.name}`);
    }

    const client = this.getOpenAIClient(provider);
    const { createReadStream } = await import('fs');

    const response = await client.audio.transcriptions.create({
      file: createReadStream(request.audioPath),
      model: provider.transcriptionModel,
      language: request.language,
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });

    return {
      text: response.text,
      segments: response.segments?.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
      })),
      language: response.language,
      duration: response.duration,
    };
  }

  // ================================
  // Connection Test
  // ================================

  async testConnection(
    providerId: string
  ): Promise<{ success: boolean; error?: string; latencyMs?: number }> {
    const provider = this.configManager.getProvider(providerId);
    if (!provider) {
      return { success: false, error: 'Provider not found' };
    }

    const startTime = Date.now();

    try {
      // Send a simple test request
      await this.chatCompletion({
        providerId,
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 5,
      });

      return {
        success: true,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latencyMs: Date.now() - startTime,
      };
    }
  }
}

// ================================
// Singleton Export
// ================================

let aiService: AIService | null = null;

export function getAIService(): AIService {
  if (!aiService) {
    aiService = new AIService();
  }
  return aiService;
}

export default getAIService;

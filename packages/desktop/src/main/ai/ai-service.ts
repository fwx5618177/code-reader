// ================================
// AI Service
// Main process implementation for AI API calls
// Supports OpenAI, Anthropic, and other providers
// ================================

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

// ================================
// Types
// ================================

export type AIProviderType = 'openai' | 'anthropic' | 'deepseek' | 'moonshot' | 'zhipu' | 'ollama';

export interface AIProviderConfig {
  id: string;
  type: AIProviderType;
  name: string;
  baseUrl?: string;
  apiKey?: string;
  isEnabled: boolean;
  defaultModel?: string;
  embeddingModel?: string;
  settings?: Record<string, unknown>;
}

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
  stream?: boolean;
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
  updatedAt: string;
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

  getEnabledProviders(): AIProviderConfig[] {
    return this.config.providers.filter((p) => p.isEnabled);
  }

  addProvider(provider: AIProviderConfig): void {
    const existing = this.config.providers.findIndex((p) => p.id === provider.id);
    if (existing >= 0) {
      this.config.providers[existing] = provider;
    } else {
      this.config.providers.push(provider);
    }
    this.saveConfig();
  }

  updateProvider(id: string, updates: Partial<AIProviderConfig>): void {
    const index = this.config.providers.findIndex((p) => p.id === id);
    if (index >= 0) {
      this.config.providers[index] = { ...this.config.providers[index], ...updates };
      this.saveConfig();
    }
  }

  removeProvider(id: string): void {
    this.config.providers = this.config.providers.filter((p) => p.id !== id);
    if (this.config.defaultProviderId === id) {
      this.config.defaultProviderId = undefined;
    }
    if (this.config.defaultEmbeddingProviderId === id) {
      this.config.defaultEmbeddingProviderId = undefined;
    }
    this.saveConfig();
  }

  setDefaultProvider(id: string): void {
    this.config.defaultProviderId = id;
    this.saveConfig();
  }

  setDefaultEmbeddingProvider(id: string): void {
    this.config.defaultEmbeddingProviderId = id;
    this.saveConfig();
  }
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

  getProviders(): AIProviderConfig[] {
    return this.configManager.getProviders();
  }

  getProvider(id: string): AIProviderConfig | undefined {
    return this.configManager.getProvider(id);
  }

  addProvider(provider: AIProviderConfig): void {
    this.configManager.addProvider(provider);
    // Clear cached client
    this.openaiClients.delete(provider.id);
    this.anthropicClients.delete(provider.id);
  }

  updateProvider(id: string, updates: Partial<AIProviderConfig>): void {
    this.configManager.updateProvider(id, updates);
    // Clear cached client
    this.openaiClients.delete(id);
    this.anthropicClients.delete(id);
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

  // ================================
  // Client Management
  // ================================

  private getOpenAIClient(provider: AIProviderConfig): OpenAI {
    let client = this.openaiClients.get(provider.id);
    if (!client) {
      client = new OpenAI({
        apiKey: provider.apiKey,
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
    const provider = request.providerId
      ? this.configManager.getProvider(request.providerId)
      : this.configManager.getDefaultProvider();

    if (!provider) {
      throw new Error('No AI provider configured');
    }

    if (!provider.apiKey) {
      throw new Error(`No API key configured for provider: ${provider.name}`);
    }

    const model = request.model || provider.defaultModel;
    if (!model) {
      throw new Error('No model specified');
    }

    switch (provider.type) {
      case 'anthropic':
        return this.anthropicChatCompletion(provider, request, model);
      case 'openai':
      case 'deepseek':
      case 'moonshot':
      case 'zhipu':
      case 'ollama':
      default:
        return this.openaiChatCompletion(provider, request, model);
    }
  }

  private async openaiChatCompletion(
    provider: AIProviderConfig,
    request: ChatCompletionRequest,
    model: string
  ): Promise<ChatCompletionResponse> {
    const client = this.getOpenAIClient(provider);

    const response = await client.chat.completions.create({
      model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
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

  private async anthropicChatCompletion(
    provider: AIProviderConfig,
    request: ChatCompletionRequest,
    model: string
  ): Promise<ChatCompletionResponse> {
    const client = this.getAnthropicClient(provider);

    // Separate system message from other messages
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const otherMessages = request.messages.filter((m) => m.role !== 'system');

    const response = await client.messages.create({
      model,
      max_tokens: request.maxTokens || 4096,
      system: systemMessage?.content,
      messages: otherMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

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

    if (!provider.apiKey) {
      throw new Error(`No API key configured for provider: ${provider.name}`);
    }

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
  // Transcription (OpenAI Whisper)
  // ================================

  async transcribe(request: TranscribeRequest): Promise<TranscribeResponse> {
    const provider = request.providerId
      ? this.configManager.getProvider(request.providerId)
      : this.configManager.getDefaultProvider();

    if (!provider) {
      throw new Error('No AI provider configured');
    }

    if (!provider.apiKey) {
      throw new Error(`No API key configured for provider: ${provider.name}`);
    }

    // Currently only OpenAI API supports transcription
    const client = this.getOpenAIClient(provider);
    const { createReadStream } = await import('fs');

    const response = await client.audio.transcriptions.create({
      file: createReadStream(request.audioPath),
      model: 'whisper-1',
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

    if (!provider.apiKey) {
      return { success: false, error: 'No API key configured' };
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

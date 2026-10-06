// ================================
// AI Provider Configuration Types
// Plugin-based architecture for AI services
// ================================

// ================================
// AI Provider Types
// ================================

/**
 * Supported AI provider identifiers
 */
export type AIProviderType =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'azure-openai'
  | 'deepseek'
  | 'moonshot'
  | 'zhipu'
  | 'ollama'
  | 'custom';

/**
 * Supported transcription provider identifiers
 */
export type TranscriptionProviderType =
  | 'openai-whisper'
  | 'azure-speech'
  | 'google-speech'
  | 'xfyun'
  | 'volcengine'
  | 'local-whisper'
  | 'custom';

// ================================
// Base Provider Configuration
// ================================

/**
 * Base configuration for all AI providers
 */
export interface BaseProviderConfig {
  /** Unique identifier for this configuration */
  id: string;
  /** Display name for the provider */
  name: string;
  /** Whether this provider is enabled */
  enabled: boolean;
  /** API key (encrypted in storage) */
  apiKey: string;
  /** Base URL for API calls */
  baseUrl?: string;
  /** Organization ID (for OpenAI) */
  organizationId?: string;
  /** Custom headers */
  customHeaders?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Max retries on failure */
  maxRetries?: number;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

// ================================
// LLM Provider Configuration
// ================================

/**
 * Model capabilities
 */
export interface ModelCapabilities {
  /** Supports text generation */
  textGeneration: boolean;
  /** Supports chat/conversation */
  chat: boolean;
  /** Supports embeddings */
  embeddings: boolean;
  /** Supports vision/images */
  vision: boolean;
  /** Supports function calling */
  functionCalling: boolean;
  /** Supports streaming */
  streaming: boolean;
  /** Max context window size */
  maxTokens: number;
}

/**
 * Model configuration
 */
export interface ModelConfig {
  /** Model identifier (e.g., 'gpt-4', 'claude-3-opus') */
  id: string;
  /** Display name */
  name: string;
  /** Model capabilities */
  capabilities: ModelCapabilities;
  /** Cost per 1K input tokens (USD) */
  inputCostPer1K?: number;
  /** Cost per 1K output tokens (USD) */
  outputCostPer1K?: number;
  /** Whether this is the default model */
  isDefault?: boolean;
}

/**
 * LLM Provider Configuration
 */
export interface LLMProviderConfig extends BaseProviderConfig {
  /** Provider type */
  type: AIProviderType;
  /** Available models */
  models: ModelConfig[];
  /** Default model for summarization */
  defaultSummarizationModel?: string;
  /** Default model for tagging */
  defaultTaggingModel?: string;
  /** Default model for embeddings */
  defaultEmbeddingModel?: string;
  /** Default model for chat */
  defaultChatModel?: string;
}

// ================================
// Transcription Provider Configuration
// ================================

/**
 * Transcription model configuration
 */
export interface TranscriptionModelConfig {
  /** Model identifier */
  id: string;
  /** Display name */
  name: string;
  /** Supported languages (ISO codes) */
  supportedLanguages: string[];
  /** Supports word-level timestamps */
  wordTimestamps: boolean;
  /** Supports speaker diarization */
  speakerDiarization: boolean;
  /** Max audio duration in seconds */
  maxDurationSeconds?: number;
  /** Supported audio formats */
  supportedFormats: string[];
}

/**
 * Transcription Provider Configuration
 */
export interface TranscriptionProviderConfig extends BaseProviderConfig {
  /** Provider type */
  type: TranscriptionProviderType;
  /** Available models */
  models: TranscriptionModelConfig[];
  /** Default model */
  defaultModel?: string;
  /** Default language */
  defaultLanguage?: string;
  /** Enable word timestamps by default */
  enableWordTimestamps?: boolean;
  /** App ID (for some providers like iFlytek) */
  appId?: string;
  /** App Secret (for some providers) */
  appSecret?: string;
}

// ================================
// Provider Presets
// ================================

/**
 * Preset configuration for quick setup
 */
export interface ProviderPreset<
  TType extends AIProviderType | TranscriptionProviderType = AIProviderType | TranscriptionProviderType,
  TModel extends ModelConfig | TranscriptionModelConfig = ModelConfig | TranscriptionModelConfig,
> {
  /** Provider type */
  type: TType;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Icon name */
  icon: string;
  /** Default base URL */
  defaultBaseUrl: string;
  /** Documentation URL */
  docsUrl: string;
  /** Available models（按服务商类别区分为 LLM 模型或转写模型） */
  availableModels: TModel[];
  /** Required fields */
  requiredFields: string[];
  /** Optional fields */
  optionalFields: string[];
}

// ================================
// AI Settings
// ================================

/**
 * AI feature settings
 */
export interface AIFeatureSettings {
  /** Enable auto-summarization */
  autoSummarize: boolean;
  /** Enable auto-tagging */
  autoTag: boolean;
  /** Enable auto-transcription */
  autoTranscribe: boolean;
  /** Enable semantic search */
  semanticSearch: boolean;
  /** Enable related content suggestions */
  relatedSuggestions: boolean;

  /** Max summary length (words) */
  summaryMaxLength: number;
  /** Max tags per item */
  maxTagsPerItem: number;
  /** Minimum confidence for auto-tags */
  tagConfidenceThreshold: number;

  /** Embedding dimensions */
  embeddingDimensions: number;
  /** Similarity threshold for related content */
  similarityThreshold: number;
}

/**
 * Complete AI configuration
 */
export interface AIConfig {
  /** Version for migration purposes */
  version: number;
  /** LLM providers */
  llmProviders: LLMProviderConfig[];
  /** Active LLM provider ID */
  activeLLMProviderId?: string;
  /** Transcription providers */
  transcriptionProviders: TranscriptionProviderConfig[];
  /** Active transcription provider ID */
  activeTranscriptionProviderId?: string;
  /** Feature settings */
  features: AIFeatureSettings;
  /** Last updated timestamp */
  updatedAt: string;
}

// ================================
// Provider Status & Health
// ================================

/**
 * Provider health status
 */
export type ProviderHealthStatus = 'healthy' | 'degraded' | 'error' | 'unknown';

/**
 * Provider health check result
 */
export interface ProviderHealthCheck {
  /** Provider ID */
  providerId: string;
  /** Status */
  status: ProviderHealthStatus;
  /** Response time in ms */
  responseTime?: number;
  /** Error message if any */
  errorMessage?: string;
  /** Last checked timestamp */
  lastChecked: string;
  /** Quota/usage info if available */
  usage?: {
    used: number;
    limit: number;
    resetAt?: string;
  };
}

// ================================
// API Request/Response Types
// ================================

/**
 * Summarization request
 */
export interface SummarizeRequest {
  /** Content to summarize */
  content: string;
  /** Content type hint */
  contentType?: 'text' | 'code' | 'transcript' | 'article';
  /** Max length in words */
  maxLength?: number;
  /** Language */
  language?: string;
  /** Include key points */
  includeKeyPoints?: boolean;
}

/**
 * Summarization response
 */
export interface SummarizeResponse {
  /** Generated summary */
  summary: string;
  /** Key points extracted */
  keyPoints?: string[];
  /** Tokens used */
  tokensUsed?: {
    input: number;
    output: number;
  };
}

/**
 * Tag extraction request
 */
export interface ExtractTagsRequest {
  /** Content to analyze */
  content: string;
  /** Title for context */
  title?: string;
  /** Existing tags to consider */
  existingTags?: string[];
  /** Max number of tags */
  maxTags?: number;
  /** Language */
  language?: string;
}

/**
 * Tag extraction response
 */
export interface ExtractTagsResponse {
  /** Suggested tags */
  tags: Array<{
    name: string;
    confidence: number;
    category?: string;
  }>;
}

/**
 * Transcription request
 */
export interface TranscribeRequest {
  /** Audio file path or base64 */
  audio: string;
  /** Audio format */
  format: string;
  /** Language hint */
  language?: string;
  /** Enable word timestamps */
  wordTimestamps?: boolean;
  /** Enable speaker detection */
  speakerDiarization?: boolean;
}

/**
 * Transcription response
 */
export interface TranscribeResponse {
  /** Full transcript text */
  text: string;
  /** Segments with timestamps */
  segments?: Array<{
    start: number;
    end: number;
    text: string;
    speaker?: string;
    confidence?: number;
  }>;
  /** Detected language */
  detectedLanguage?: string;
  /** Duration in seconds */
  duration?: number;
}

/**
 * Embedding request
 */
export interface EmbeddingRequest {
  /** Text to embed */
  text: string;
  /** Model to use */
  model?: string;
}

/**
 * Embedding response
 */
export interface EmbeddingResponse {
  /** Embedding vector */
  embedding: number[];
  /** Dimensions */
  dimensions: number;
  /** Tokens used */
  tokensUsed?: number;
}

// ================================
// Default Configurations
// ================================

/**
 * Default AI feature settings
 */
export const DEFAULT_AI_FEATURE_SETTINGS: AIFeatureSettings = {
  autoSummarize: true,
  autoTag: true,
  autoTranscribe: true,
  semanticSearch: false,
  relatedSuggestions: true,
  summaryMaxLength: 150,
  maxTagsPerItem: 5,
  tagConfidenceThreshold: 0.7,
  embeddingDimensions: 1536,
  similarityThreshold: 0.75,
};

/**
 * Default AI configuration
 */
export const DEFAULT_AI_CONFIG: AIConfig = {
  version: 1,
  llmProviders: [],
  transcriptionProviders: [],
  features: DEFAULT_AI_FEATURE_SETTINGS,
  updatedAt: new Date().toISOString(),
};

// ================================
// Provider Presets Data
// ================================

export const LLM_PROVIDER_PRESETS: ProviderPreset<AIProviderType, ModelConfig>[] = [
  {
    type: 'openai',
    name: 'OpenAI',
    description: 'GPT-4, GPT-3.5 等模型',
    icon: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/docs',
    availableModels: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: {
          textGeneration: true,
          chat: true,
          embeddings: false,
          vision: true,
          functionCalling: true,
          streaming: true,
          maxTokens: 128000,
        },
        inputCostPer1K: 0.005,
        outputCostPer1K: 0.015,
        isDefault: true,
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        capabilities: {
          textGeneration: true,
          chat: true,
          embeddings: false,
          vision: true,
          functionCalling: true,
          streaming: true,
          maxTokens: 128000,
        },
        inputCostPer1K: 0.00015,
        outputCostPer1K: 0.0006,
      },
      {
        id: 'text-embedding-3-small',
        name: 'Embedding 3 Small',
        capabilities: {
          textGeneration: false,
          chat: false,
          embeddings: true,
          vision: false,
          functionCalling: false,
          streaming: false,
          maxTokens: 8191,
        },
        inputCostPer1K: 0.00002,
      },
    ],
    requiredFields: ['apiKey'],
    optionalFields: ['organizationId', 'baseUrl'],
  },
  {
    type: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 3.5, Claude 3 系列模型',
    icon: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    docsUrl: 'https://docs.anthropic.com',
    availableModels: [
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        capabilities: {
          textGeneration: true,
          chat: true,
          embeddings: false,
          vision: true,
          functionCalling: true,
          streaming: true,
          maxTokens: 200000,
        },
        inputCostPer1K: 0.003,
        outputCostPer1K: 0.015,
        isDefault: true,
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        capabilities: {
          textGeneration: true,
          chat: true,
          embeddings: false,
          vision: true,
          functionCalling: true,
          streaming: true,
          maxTokens: 200000,
        },
        inputCostPer1K: 0.0008,
        outputCostPer1K: 0.004,
      },
    ],
    requiredFields: ['apiKey'],
    optionalFields: ['baseUrl'],
  },
  {
    type: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek V3, DeepSeek Coder',
    icon: 'deepseek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    docsUrl: 'https://platform.deepseek.com/docs',
    availableModels: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        capabilities: {
          textGeneration: true,
          chat: true,
          embeddings: false,
          vision: false,
          functionCalling: true,
          streaming: true,
          maxTokens: 65536,
        },
        inputCostPer1K: 0.00014,
        outputCostPer1K: 0.00028,
        isDefault: true,
      },
    ],
    requiredFields: ['apiKey'],
    optionalFields: ['baseUrl'],
  },
  {
    type: 'moonshot',
    name: 'Moonshot (Kimi)',
    description: '月之暗面 Kimi 大模型',
    icon: 'moonshot',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    docsUrl: 'https://platform.moonshot.cn/docs',
    availableModels: [
      {
        id: 'moonshot-v1-128k',
        name: 'Moonshot 128K',
        capabilities: {
          textGeneration: true,
          chat: true,
          embeddings: false,
          vision: false,
          functionCalling: true,
          streaming: true,
          maxTokens: 128000,
        },
        isDefault: true,
      },
    ],
    requiredFields: ['apiKey'],
    optionalFields: ['baseUrl'],
  },
  {
    type: 'zhipu',
    name: '智谱 AI',
    description: 'GLM-4 系列模型',
    icon: 'zhipu',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    docsUrl: 'https://open.bigmodel.cn/dev/api',
    availableModels: [
      {
        id: 'glm-4-plus',
        name: 'GLM-4 Plus',
        capabilities: {
          textGeneration: true,
          chat: true,
          embeddings: false,
          vision: false,
          functionCalling: true,
          streaming: true,
          maxTokens: 128000,
        },
        isDefault: true,
      },
      {
        id: 'embedding-3',
        name: 'Embedding 3',
        capabilities: {
          textGeneration: false,
          chat: false,
          embeddings: true,
          vision: false,
          functionCalling: false,
          streaming: false,
          maxTokens: 8192,
        },
      },
    ],
    requiredFields: ['apiKey'],
    optionalFields: ['baseUrl'],
  },
  {
    type: 'ollama',
    name: 'Ollama (Local)',
    description: '本地运行的 LLM (Llama, Mistral 等)',
    icon: 'ollama',
    defaultBaseUrl: 'http://localhost:11434/api',
    docsUrl: 'https://ollama.ai/docs',
    availableModels: [],
    requiredFields: ['baseUrl'],
    optionalFields: [],
  },
];

export const TRANSCRIPTION_PROVIDER_PRESETS: ProviderPreset<
  TranscriptionProviderType,
  TranscriptionModelConfig
>[] = [
  {
    type: 'openai-whisper',
    name: 'OpenAI Whisper',
    description: 'OpenAI 官方 Whisper API',
    icon: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/docs/guides/speech-to-text',
    availableModels: [
      {
        id: 'whisper-1',
        name: 'Whisper V2',
        supportedLanguages: ['auto', 'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es'],
        wordTimestamps: true,
        speakerDiarization: false,
        maxDurationSeconds: 7200,
        supportedFormats: ['mp3', 'mp4', 'wav', 'webm', 'm4a', 'flac', 'ogg'],
      },
    ],
    requiredFields: ['apiKey'],
    optionalFields: ['baseUrl'],
  },
  {
    type: 'azure-speech',
    name: 'Azure Speech',
    description: '微软 Azure 语音服务',
    icon: 'azure',
    defaultBaseUrl: '',
    docsUrl: 'https://docs.microsoft.com/azure/cognitive-services/speech-service',
    availableModels: [
      {
        id: 'azure-speech-default',
        name: 'Azure Speech',
        supportedLanguages: ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR'],
        wordTimestamps: true,
        speakerDiarization: true,
        supportedFormats: ['wav', 'mp3', 'ogg', 'flac'],
      },
    ],
    requiredFields: ['apiKey', 'baseUrl'],
    optionalFields: [],
  },
  {
    type: 'xfyun',
    name: '讯飞语音',
    description: '科大讯飞语音转写',
    icon: 'xfyun',
    defaultBaseUrl: 'https://raasr.xfyun.cn/v2/api',
    docsUrl: 'https://www.xfyun.cn/doc/asr/lfasr/API.html',
    availableModels: [
      {
        id: 'xfyun-lfasr',
        name: '讯飞转写',
        supportedLanguages: ['zh', 'en'],
        wordTimestamps: true,
        speakerDiarization: true,
        maxDurationSeconds: 18000,
        supportedFormats: ['wav', 'mp3', 'm4a', 'flac'],
      },
    ],
    requiredFields: ['appId', 'apiKey', 'appSecret'],
    optionalFields: ['baseUrl'],
  },
  {
    type: 'volcengine',
    name: '火山引擎',
    description: '字节跳动语音识别',
    icon: 'volcengine',
    defaultBaseUrl: 'https://openspeech.bytedance.com/api/v1/auc',
    docsUrl: 'https://www.volcengine.com/docs/6561/80818',
    availableModels: [
      {
        id: 'volcengine-asr',
        name: '火山 ASR',
        supportedLanguages: ['zh', 'en'],
        wordTimestamps: true,
        speakerDiarization: false,
        supportedFormats: ['wav', 'mp3', 'pcm'],
      },
    ],
    requiredFields: ['appId', 'apiKey'],
    optionalFields: ['baseUrl'],
  },
  {
    type: 'local-whisper',
    name: 'Local Whisper',
    description: '本地运行 Whisper (whisper.cpp)',
    icon: 'whisper',
    defaultBaseUrl: 'http://localhost:8080',
    docsUrl: 'https://github.com/ggerganov/whisper.cpp',
    availableModels: [
      {
        id: 'whisper-base',
        name: 'Whisper Base',
        supportedLanguages: ['auto'],
        wordTimestamps: true,
        speakerDiarization: false,
        supportedFormats: ['wav', 'mp3'],
      },
      {
        id: 'whisper-small',
        name: 'Whisper Small',
        supportedLanguages: ['auto'],
        wordTimestamps: true,
        speakerDiarization: false,
        supportedFormats: ['wav', 'mp3'],
      },
      {
        id: 'whisper-medium',
        name: 'Whisper Medium',
        supportedLanguages: ['auto'],
        wordTimestamps: true,
        speakerDiarization: false,
        supportedFormats: ['wav', 'mp3'],
      },
      {
        id: 'whisper-large',
        name: 'Whisper Large',
        supportedLanguages: ['auto'],
        wordTimestamps: true,
        speakerDiarization: false,
        supportedFormats: ['wav', 'mp3'],
      },
    ],
    requiredFields: ['baseUrl'],
    optionalFields: [],
  },
];

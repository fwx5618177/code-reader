// ================================
// Electron API Type Definitions
// Exposed via preload.ts
// ================================

// ================================
// Database Types
// ================================

interface FTSResult {
  id: string;
  rank: number;
  snippet: string;
  title?: string;
  type?: string;
}

interface DatabaseStats {
  pageSize: number;
  pageCount: number;
  dbSizeBytes: number;
  walSizeBytes: number;
}

interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

// ================================
// AI Types
// ================================

interface AIProviderConfig {
  id: string;
  type: string;
  name: string;
  baseUrl?: string;
  apiKey?: string;
  isEnabled: boolean;
  defaultModel?: string;
  embeddingModel?: string;
  settings?: Record<string, unknown>;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionRequest {
  providerId?: string;
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

interface ChatCompletionResponse {
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

interface EmbeddingRequest {
  providerId?: string;
  model?: string;
  input: string | string[];
}

interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
}

interface SummarizeRequest {
  content: string;
  maxLength?: number;
  language?: string;
  providerId?: string;
}

interface SummarizeResponse {
  summary: string;
  keyPoints: string[];
}

interface ExtractTagsRequest {
  content: string;
  maxTags?: number;
  existingTags?: string[];
  providerId?: string;
}

interface ExtractTagsResponse {
  tags: Array<{
    name: string;
    confidence: number;
  }>;
}

interface TranscribeRequest {
  audioPath: string;
  language?: string;
  providerId?: string;
}

interface TranscribeResponse {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  language?: string;
  duration?: number;
}

interface TestConnectionResult {
  success: boolean;
  error?: string;
  latencyMs?: number;
}

// ================================
// Agent Types
// ================================

type TaskType =
  | 'transcribe'
  | 'summarize'
  | 'extract-tags'
  | 'categorize'
  | 'extract-entities'
  | 'generate-embedding'
  | 'find-related';

type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

interface AgentTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  targetItemId: string;
  priority: number;
  progress: number;
  errorMessage?: string;
  retryCount: number;
  maxRetries: number;
  result?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface TaskProgress {
  taskId: string;
  progress: number;
  status: TaskStatus;
  message?: string;
}

interface ProcessItemOptions {
  transcribe?: boolean;
  summarize?: boolean;
  extractTags?: boolean;
  generateEmbedding?: boolean;
  findRelated?: boolean;
}

// ================================
// Search Types
// ================================

interface SemanticSearchResult {
  itemId: string;
  title: string;
  type: string;
  similarity: number;
  snippet?: string;
  createdAt: string;
}

interface SemanticSearchOptions {
  limit?: number;
  threshold?: number;
  types?: string[];
  folderId?: string;
  projectId?: string;
  includeDeleted?: boolean;
}

interface HybridSearchResult extends SemanticSearchResult {
  ftsScore?: number;
  combinedScore: number;
}

interface HybridSearchOptions extends SemanticSearchOptions {
  semanticWeight?: number;
}

// ================================
// Version History Types
// ================================

type ChangeType = 'create' | 'edit' | 'auto-save' | 'restore' | 'ai-update';
type AuthorType = 'user' | 'ai' | 'system';

interface DocumentVersion {
  id: string;
  itemId: string;
  versionNumber: number;
  title: string | null;
  content: string | null;
  summary: string | null;
  changeType: ChangeType;
  changeDescription: string | null;
  diffFromPrevious: string | null;
  contentHash: string | null;
  contentSize: number | null;
  authorType: AuthorType;
  createdAt: string;
}

interface CreateVersionInput {
  itemId: string;
  title?: string;
  content?: string;
  summary?: string;
  changeType?: ChangeType;
  changeDescription?: string;
  authorType?: AuthorType;
}

interface VersionListOptions {
  itemId: string;
  limit?: number;
  offset?: number;
  changeTypes?: ChangeType[];
}

// ================================
// Electron API Interface
// ================================

interface ElectronAPI {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
    once: (channel: string, callback: (...args: unknown[]) => void) => void;
    removeListener: (channel: string, callback: (...args: unknown[]) => void) => void;
    removeAllListeners: (channel: string) => void;
  };

  platform: NodeJS.Platform;

  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    createChild: (mode: string) => Promise<{ windowId: string; success: boolean }>;
  };

  database: {
    initialize: () => Promise<{ success: boolean }>;
    close: () => Promise<{ success: boolean }>;
    run: (sql: string, params?: unknown[]) => Promise<RunResult>;
    get: <T>(sql: string, params?: unknown[]) => Promise<T | undefined>;
    all: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    search: (
      query: string,
      options?: { types?: string[]; limit?: number; offset?: number }
    ) => Promise<FTSResult[]>;
    getSchemaVersion: () => Promise<number>;
    backup: (path?: string) => Promise<{ success: boolean; path: string }>;
    vacuum: () => Promise<{ success: boolean }>;
    stats: () => Promise<DatabaseStats>;
  };

  ai: {
    getProviders: () => Promise<AIProviderConfig[]>;
    getProvider: (id: string) => Promise<AIProviderConfig | undefined>;
    addProvider: (provider: AIProviderConfig) => Promise<{ success: boolean }>;
    updateProvider: (
      id: string,
      updates: Partial<AIProviderConfig>
    ) => Promise<{ success: boolean }>;
    removeProvider: (id: string) => Promise<{ success: boolean }>;
    setDefaultProvider: (id: string) => Promise<{ success: boolean }>;
    setDefaultEmbeddingProvider: (id: string) => Promise<{ success: boolean }>;
    testConnection: (providerId: string) => Promise<TestConnectionResult>;
    chatCompletion: (request: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
    createEmbeddings: (request: EmbeddingRequest) => Promise<EmbeddingResponse>;
    summarize: (request: SummarizeRequest) => Promise<SummarizeResponse>;
    extractTags: (request: ExtractTagsRequest) => Promise<ExtractTagsResponse>;
    transcribe: (request: TranscribeRequest) => Promise<TranscribeResponse>;
  };

  agent: {
    start: () => Promise<{ success: boolean }>;
    stop: () => Promise<{ success: boolean }>;
    isActive: () => Promise<boolean>;
    createTask: (
      type: TaskType,
      targetItemId: string,
      options?: { priority?: number; maxRetries?: number }
    ) => Promise<string>;
    cancelTask: (taskId: string) => Promise<boolean>;
    getTask: (taskId: string) => Promise<AgentTask | undefined>;
    getPendingCount: () => Promise<number>;
    getTasksForItem: (itemId: string) => Promise<AgentTask[]>;
    processItem: (targetItemId: string, options?: ProcessItemOptions) => Promise<string[]>;
    onProgress: (callback: (progress: TaskProgress) => void) => () => void;
  };

  search: {
    semantic: (query: string, options?: SemanticSearchOptions) => Promise<SemanticSearchResult[]>;
    findSimilar: (
      itemId: string,
      options?: SemanticSearchOptions
    ) => Promise<SemanticSearchResult[]>;
    hybrid: (query: string, options?: HybridSearchOptions) => Promise<HybridSearchResult[]>;
    clearCache: () => Promise<{ success: boolean }>;
  };

  version: {
    create: (input: CreateVersionInput) => Promise<DocumentVersion>;
    getHistory: (options: VersionListOptions) => Promise<DocumentVersion[]>;
    get: (versionId: string) => Promise<DocumentVersion | null>;
    getLatest: (itemId: string) => Promise<DocumentVersion | null>;
    getByNumber: (itemId: string, versionNumber: number) => Promise<DocumentVersion | null>;
    restore: (itemId: string, versionId: string) => Promise<DocumentVersion>;
    getCount: (itemId: string) => Promise<number>;
    prune: (itemId: string, keepCount?: number) => Promise<number>;
    autoSave: (
      itemId: string,
      content: string,
      options?: { title?: string; minIntervalMs?: number }
    ) => Promise<DocumentVersion | null>;
    shouldAutoSave: (itemId: string, minIntervalMs?: number) => Promise<boolean>;
  };

}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};

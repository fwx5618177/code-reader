// ================================
// AI IPC Handlers
// Bridge between renderer and main process AI service
// ================================

import { ipcMain } from 'electron';
import {
  getAIService,
  type AIProviderConfig,
  type ChatCompletionRequest,
  type EmbeddingRequest,
  type SummarizeRequest,
  type ExtractTagsRequest,
  type TranscribeRequest,
} from './ai-service';

/**
 * Register all AI-related IPC handlers
 */
export function registerAIHandlers(): void {
  const aiService = getAIService();

  // ================================
  // Provider Management
  // ================================

  /**
   * Get all configured providers
   */
  ipcMain.handle('ai:getProviders', async () => {
    try {
      const providers = aiService.getProviders();
      // Remove API keys from response for security
      return providers.map((p) => ({
        ...p,
        apiKey: p.apiKey ? '••••••••' : undefined,
      }));
    } catch (error) {
      console.error('[AI:IPC] Get providers error:', error);
      throw error;
    }
  });

  /**
   * Get a specific provider
   */
  ipcMain.handle('ai:getProvider', async (_event, id: string) => {
    try {
      const provider = aiService.getProvider(id);
      if (provider) {
        return {
          ...provider,
          apiKey: provider.apiKey ? '••••••••' : undefined,
        };
      }
      return undefined;
    } catch (error) {
      console.error('[AI:IPC] Get provider error:', error);
      throw error;
    }
  });

  /**
   * Add or update a provider
   */
  ipcMain.handle('ai:addProvider', async (_event, provider: AIProviderConfig) => {
    try {
      aiService.addProvider(provider);
      return { success: true };
    } catch (error) {
      console.error('[AI:IPC] Add provider error:', error);
      throw error;
    }
  });

  /**
   * Update a provider
   */
  ipcMain.handle(
    'ai:updateProvider',
    async (_event, id: string, updates: Partial<AIProviderConfig>) => {
      try {
        aiService.updateProvider(id, updates);
        return { success: true };
      } catch (error) {
        console.error('[AI:IPC] Update provider error:', error);
        throw error;
      }
    }
  );

  /**
   * Remove a provider
   */
  ipcMain.handle('ai:removeProvider', async (_event, id: string) => {
    try {
      aiService.removeProvider(id);
      return { success: true };
    } catch (error) {
      console.error('[AI:IPC] Remove provider error:', error);
      throw error;
    }
  });

  /**
   * Set default provider
   */
  ipcMain.handle('ai:setDefaultProvider', async (_event, id: string) => {
    try {
      aiService.setDefaultProvider(id);
      return { success: true };
    } catch (error) {
      console.error('[AI:IPC] Set default provider error:', error);
      throw error;
    }
  });

  /**
   * Set default embedding provider
   */
  ipcMain.handle('ai:setDefaultEmbeddingProvider', async (_event, id: string) => {
    try {
      aiService.setDefaultEmbeddingProvider(id);
      return { success: true };
    } catch (error) {
      console.error('[AI:IPC] Set default embedding provider error:', error);
      throw error;
    }
  });

  /**
   * Test provider connection
   */
  ipcMain.handle('ai:testConnection', async (_event, providerId: string) => {
    try {
      return await aiService.testConnection(providerId);
    } catch (error) {
      console.error('[AI:IPC] Test connection error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // ================================
  // AI Operations
  // ================================

  /**
   * Chat completion
   */
  ipcMain.handle('ai:chatCompletion', async (_event, request: ChatCompletionRequest) => {
    try {
      return await aiService.chatCompletion(request);
    } catch (error) {
      console.error('[AI:IPC] Chat completion error:', error);
      throw error;
    }
  });

  /**
   * Create embeddings
   */
  ipcMain.handle('ai:createEmbeddings', async (_event, request: EmbeddingRequest) => {
    try {
      return await aiService.createEmbeddings(request);
    } catch (error) {
      console.error('[AI:IPC] Create embeddings error:', error);
      throw error;
    }
  });

  /**
   * Summarize content
   */
  ipcMain.handle('ai:summarize', async (_event, request: SummarizeRequest) => {
    try {
      return await aiService.summarize(request);
    } catch (error) {
      console.error('[AI:IPC] Summarize error:', error);
      throw error;
    }
  });

  /**
   * Extract tags from content
   */
  ipcMain.handle('ai:extractTags', async (_event, request: ExtractTagsRequest) => {
    try {
      return await aiService.extractTags(request);
    } catch (error) {
      console.error('[AI:IPC] Extract tags error:', error);
      throw error;
    }
  });

  /**
   * Transcribe audio
   */
  ipcMain.handle('ai:transcribe', async (_event, request: TranscribeRequest) => {
    try {
      return await aiService.transcribe(request);
    } catch (error) {
      console.error('[AI:IPC] Transcribe error:', error);
      throw error;
    }
  });

  console.log('[AI:IPC] AI handlers registered');
}

/**
 * Cleanup AI handlers
 */
export function cleanupAIHandlers(): void {
  const handlers = [
    'ai:getProviders',
    'ai:getProvider',
    'ai:addProvider',
    'ai:updateProvider',
    'ai:removeProvider',
    'ai:setDefaultProvider',
    'ai:setDefaultEmbeddingProvider',
    'ai:testConnection',
    'ai:chatCompletion',
    'ai:createEmbeddings',
    'ai:summarize',
    'ai:extractTags',
    'ai:transcribe',
  ];

  handlers.forEach((channel) => {
    ipcMain.removeHandler(channel);
  });

  console.log('[AI:IPC] AI handlers cleaned up');
}

export default registerAIHandlers;

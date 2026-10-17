// ================================
// AI IPC Handlers
// Bridge between renderer and main process AI service
// ================================

import { ipcMain } from 'electron';
import {
  getAIService,
  type ChatCompletionRequest,
  type EmbeddingRequest,
  type SummarizeRequest,
  type ExtractTagsRequest,
  type TranscribeRequest,
} from './ai-service';
import type { AIProviderInput, AIProviderUpdate } from './provider-config';

/**
 * 进行中的流式对话，用于停止生成
 * streamId 只在发起窗口内唯一，因此以「窗口 id + streamId」作为键
 */
const activeStreams = new Map<string, AbortController>();

const streamKey = (senderId: number, streamId: string) => `${senderId}:${streamId}`;

/**
 * Register all AI-related IPC handlers
 */
export function registerAIHandlers(): void {
  const aiService = getAIService();

  // ================================
  // Provider Management
  // ================================

  /**
   * 获取配置快照：服务商列表（不含密钥）与生效的默认服务商
   */
  ipcMain.handle('ai:getConfig', async () => {
    try {
      return aiService.getConfigSnapshot();
    } catch (error) {
      console.error('[AI:IPC] Get config error:', error);
      throw error;
    }
  });

  /**
   * 新增服务商，返回不含密钥的视图
   */
  ipcMain.handle('ai:addProvider', async (_event, input: AIProviderInput) => {
    try {
      return aiService.addProvider(input);
    } catch (error) {
      console.error('[AI:IPC] Add provider error:', error);
      throw error;
    }
  });

  /**
   * 更新服务商；apiKey 缺省或为空时保留已存储的密钥
   */
  ipcMain.handle(
    'ai:updateProvider',
    async (_event, id: string, updates: AIProviderUpdate) => {
      try {
        return aiService.updateProvider(id, updates);
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
   * 设置默认转写服务商（须已配置转写模型）
   */
  ipcMain.handle('ai:setDefaultTranscriptionProvider', async (_event, id: string) => {
    try {
      aiService.setDefaultTranscriptionProvider(id);
      return { success: true };
    } catch (error) {
      console.error('[AI:IPC] Set default transcription provider error:', error);
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
   * 流式对话：增量文本通过 ai:chatChunk 事件（带 streamId）推送给发起请求的窗口，
   * invoke 本身在生成结束后返回完整结果，失败时以 invoke 拒绝的形式传回错误；
   * 被 ai:chatStreamCancel 停止时正常返回已生成的部分（aborted 为 true）
   */
  ipcMain.handle(
    'ai:chatStream',
    async (event, streamId: string, request: ChatCompletionRequest) => {
      const key = streamKey(event.sender.id, streamId);
      const controller = new AbortController();
      activeStreams.set(key, controller);
      try {
        return await aiService.chatCompletionStream(
          request,
          (delta) => {
            // 窗口在生成中途关闭时不再推送
            if (!event.sender.isDestroyed()) {
              event.sender.send('ai:chatChunk', { streamId, delta });
            }
          },
          controller.signal
        );
      } catch (error) {
        console.error('[AI:IPC] Chat stream error:', error);
        throw error;
      } finally {
        activeStreams.delete(key);
      }
    }
  );

  /**
   * 停止流式对话；对话已结束时无作用
   */
  ipcMain.handle('ai:chatStreamCancel', (event, streamId: string) => {
    activeStreams.get(streamKey(event.sender.id, streamId))?.abort();
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
    'ai:getConfig',
    'ai:addProvider',
    'ai:updateProvider',
    'ai:removeProvider',
    'ai:setDefaultProvider',
    'ai:setDefaultEmbeddingProvider',
    'ai:setDefaultTranscriptionProvider',
    'ai:testConnection',
    'ai:chatCompletion',
    'ai:chatStream',
    'ai:chatStreamCancel',
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

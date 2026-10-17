// ================================
// 旧版 AI 配置迁移解析测试
// 核心约束：旧版 reverse(btoa(key)) 混淆的密钥可被还原，服务商与默认项正确映射
// ================================

import { describe, expect, it } from 'vitest';
import { readLegacyAIConfig } from '../legacy-config';

/** 旧版渲染进程 aiConfigService 写入密钥时使用的混淆方式 */
const legacyObfuscate = (key: string) => btoa(key).split('').reverse().join('');

const chatModel = (id: string, isDefault = false) => ({
  id,
  isDefault,
  capabilities: { chat: true, embeddings: false },
});
const embeddingModel = (id: string) => ({ id, capabilities: { chat: false, embeddings: true } });

describe('readLegacyAIConfig', () => {
  it('还原密钥并映射对话 / 向量模型与默认服务商', () => {
    const result = readLegacyAIConfig(
      JSON.stringify({
        llmProviders: [
          {
            id: 'llm-1',
            type: 'openai',
            name: 'OpenAI',
            enabled: true,
            apiKey: legacyObfuscate('sk-openai-123'),
            baseUrl: 'https://api.openai.com/v1',
            models: [
              chatModel('gpt-4o-mini'),
              chatModel('gpt-4o', true),
              embeddingModel('text-embedding-3-small'),
            ],
          },
          {
            id: 'llm-2',
            type: 'deepseek',
            name: 'DeepSeek',
            enabled: false,
            apiKey: legacyObfuscate('sk-deepseek'),
            models: [chatModel('deepseek-chat', true)],
          },
        ],
        activeLLMProviderId: 'llm-2',
      })
    );

    expect(result.skipped).toEqual([]);
    expect(result.defaultProviderId).toBe('llm-2');
    expect(result.providers).toEqual([
      {
        id: 'llm-1',
        type: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai-123',
        isEnabled: true,
        defaultModel: 'gpt-4o',
        embeddingModel: 'text-embedding-3-small',
      },
      {
        id: 'llm-2',
        type: 'deepseek',
        name: 'DeepSeek',
        baseUrl: undefined,
        apiKey: 'sk-deepseek',
        isEnabled: false,
        defaultModel: 'deepseek-chat',
        embeddingModel: undefined,
      },
    ]);
  });

  it('Whisper 转写服务商与同账号 OpenAI 服务商合并', () => {
    const apiKey = legacyObfuscate('sk-shared');
    const result = readLegacyAIConfig(
      JSON.stringify({
        llmProviders: [
          {
            id: 'llm-1',
            type: 'openai',
            name: 'OpenAI',
            enabled: true,
            apiKey,
            baseUrl: 'https://api.openai.com/v1',
            models: [chatModel('gpt-4o', true)],
          },
        ],
        transcriptionProviders: [
          {
            id: 'tr-1',
            type: 'openai-whisper',
            name: 'Whisper',
            enabled: true,
            apiKey,
            baseUrl: 'https://api.openai.com/v1',
            models: [{ id: 'whisper-1' }],
          },
        ],
        activeTranscriptionProviderId: 'tr-1',
      })
    );

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].transcriptionModel).toBe('whisper-1');
    expect(result.defaultTranscriptionProviderId).toBe('llm-1');
  });

  it('独立 Whisper 服务商导入为 openai 类型，不支持的类型被跳过', () => {
    const result = readLegacyAIConfig(
      JSON.stringify({
        llmProviders: [{ id: 'g-1', type: 'google', name: 'Gemini', apiKey: '' }],
        transcriptionProviders: [
          {
            id: 'tr-1',
            type: 'openai-whisper',
            name: 'Whisper',
            enabled: true,
            apiKey: legacyObfuscate('sk-whisper'),
            models: [{ id: 'whisper-1' }],
          },
          { id: 'tr-2', type: 'xfyun', name: '讯飞', apiKey: '' },
        ],
      })
    );

    expect(result.skipped).toEqual(['Gemini (google)', '讯飞 (xfyun)']);
    expect(result.providers).toEqual([
      {
        id: 'tr-1',
        type: 'openai',
        name: 'Whisper',
        baseUrl: undefined,
        apiKey: 'sk-whisper',
        isEnabled: true,
        transcriptionModel: 'whisper-1',
      },
    ]);
    expect(result.defaultProviderId).toBeUndefined();
  });

  it('非法 JSON 抛出异常以便保留旧文件', () => {
    expect(() => readLegacyAIConfig('{not json')).toThrow();
  });
});

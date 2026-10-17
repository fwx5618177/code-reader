// ================================
// 服务商配置规则测试
// 核心约束：Ollama 无需密钥，且始终使用 OpenAI 兼容的 /v1 地址
// ================================

import { describe, expect, it } from 'vitest';
import {
  OLLAMA_DEFAULT_BASE_URL,
  normalizeProviderBaseUrl,
  providerRequiresApiKey,
} from '../provider-config';

describe('providerRequiresApiKey', () => {
  it('只有本地服务商可以不配置密钥', () => {
    expect(providerRequiresApiKey('ollama')).toBe(false);
    expect(providerRequiresApiKey('openai')).toBe(true);
    expect(providerRequiresApiKey('anthropic')).toBe(true);
  });
});

describe('normalizeProviderBaseUrl', () => {
  it('Ollama 未填地址时使用本机默认地址', () => {
    expect(normalizeProviderBaseUrl('ollama', undefined)).toBe(OLLAMA_DEFAULT_BASE_URL);
  });

  it('旧预设的原生 /api 地址改写为 /v1', () => {
    expect(normalizeProviderBaseUrl('ollama', 'http://localhost:11434/api')).toBe(
      'http://localhost:11434/v1'
    );
    expect(normalizeProviderBaseUrl('ollama', 'http://192.168.1.5:11434/api/')).toBe(
      'http://192.168.1.5:11434/v1'
    );
  });

  it('已是兼容地址时保持不变（仅去掉末尾斜杠）', () => {
    expect(normalizeProviderBaseUrl('ollama', 'http://localhost:11434/v1/')).toBe(
      'http://localhost:11434/v1'
    );
  });

  it('其他服务商的地址原样保留', () => {
    expect(normalizeProviderBaseUrl('zhipu', 'https://open.bigmodel.cn/api')).toBe(
      'https://open.bigmodel.cn/api'
    );
    expect(normalizeProviderBaseUrl('openai', undefined)).toBeUndefined();
  });
});

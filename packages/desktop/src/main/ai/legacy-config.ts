// ================================
// 旧版 AI 配置解析
// 旧版渲染进程曾把服务商写入 <userData>/ai-config.json（llmProviders / transcriptionProviders，
// 密钥经 base64 + 反转混淆）。此处将其转换为主进程配置结构，供一次性迁移使用。
// ================================

import { isAIProviderType, type AIProviderConfig } from './provider-config';

interface LegacyModel {
  id?: string;
  isDefault?: boolean;
  capabilities?: { chat?: boolean; embeddings?: boolean };
}

interface LegacyProvider {
  id?: string;
  type?: string;
  name?: string;
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  models?: LegacyModel[];
  /** LLM 服务商字段 */
  defaultChatModel?: string;
  defaultEmbeddingModel?: string;
  /** 转写服务商字段 */
  defaultModel?: string;
}

interface LegacyConfigFile {
  llmProviders?: LegacyProvider[];
  activeLLMProviderId?: string;
  transcriptionProviders?: LegacyProvider[];
  activeTranscriptionProviderId?: string;
}

export interface LegacyImportResult {
  providers: AIProviderConfig[];
  defaultProviderId?: string;
  defaultTranscriptionProviderId?: string;
  /** 主进程不支持而被跳过的服务商（名称 + 类型） */
  skipped: string[];
}

/** 旧版转写服务商中，唯一可由主进程（OpenAI 兼容接口）承接的类型 */
const LEGACY_WHISPER_TYPE = 'openai-whisper';

/**
 * 还原旧版混淆：旧版写入时为 reverse(btoa(key))，读取失败时按原文处理
 */
function deobfuscateKey(obfuscated: string | undefined): string | undefined {
  if (!obfuscated) return undefined;
  try {
    return atob(obfuscated.split('').reverse().join(''));
  } catch {
    return obfuscated;
  }
}

function pickChatModel(provider: LegacyProvider): string | undefined {
  const models = provider.models ?? [];
  return (
    provider.defaultChatModel ??
    models.find((m) => m.isDefault && m.capabilities?.chat)?.id ??
    models.find((m) => m.capabilities?.chat)?.id
  );
}

function pickEmbeddingModel(provider: LegacyProvider): string | undefined {
  return (
    provider.defaultEmbeddingModel ??
    provider.models?.find((m) => m.capabilities?.embeddings)?.id
  );
}

function describe(provider: LegacyProvider): string {
  return `${provider.name ?? provider.id ?? 'unknown'} (${provider.type ?? 'unknown'})`;
}

/**
 * 解析旧版配置文件内容；JSON 非法时抛出异常，由调用方决定是否保留旧文件
 */
export function readLegacyAIConfig(content: string): LegacyImportResult {
  const legacy = JSON.parse(content) as LegacyConfigFile;
  const providers: AIProviderConfig[] = [];
  const skipped: string[] = [];
  const idMap = new Map<string, string>();

  for (const item of Array.isArray(legacy.llmProviders) ? legacy.llmProviders : []) {
    if (!item.id || !isAIProviderType(item.type)) {
      skipped.push(describe(item));
      continue;
    }
    providers.push({
      id: item.id,
      type: item.type,
      name: item.name || item.type,
      baseUrl: item.baseUrl || undefined,
      apiKey: deobfuscateKey(item.apiKey),
      isEnabled: item.enabled !== false,
      defaultModel: pickChatModel(item),
      embeddingModel: pickEmbeddingModel(item),
    });
    idMap.set(item.id, item.id);
  }

  for (const item of Array.isArray(legacy.transcriptionProviders)
    ? legacy.transcriptionProviders
    : []) {
    if (!item.id || item.type !== LEGACY_WHISPER_TYPE) {
      skipped.push(describe(item));
      continue;
    }
    const apiKey = deobfuscateKey(item.apiKey);
    const baseUrl = item.baseUrl || undefined;
    const transcriptionModel = item.defaultModel ?? item.models?.[0]?.id;

    // 与已导入的 OpenAI 服务商使用同一账号时合并，避免出现两份相同凭据
    const sameAccount = providers.find(
      (p) => p.type === 'openai' && p.apiKey === apiKey && p.baseUrl === baseUrl
    );
    if (sameAccount) {
      sameAccount.transcriptionModel = sameAccount.transcriptionModel ?? transcriptionModel;
      idMap.set(item.id, sameAccount.id);
      continue;
    }

    providers.push({
      id: item.id,
      type: 'openai',
      name: item.name || 'OpenAI Whisper',
      baseUrl,
      apiKey,
      isEnabled: item.enabled !== false,
      transcriptionModel,
    });
    idMap.set(item.id, item.id);
  }

  return {
    providers,
    defaultProviderId: legacy.activeLLMProviderId
      ? idMap.get(legacy.activeLLMProviderId)
      : undefined,
    defaultTranscriptionProviderId: legacy.activeTranscriptionProviderId
      ? idMap.get(legacy.activeTranscriptionProviderId)
      : undefined,
    skipped,
  };
}

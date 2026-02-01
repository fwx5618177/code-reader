// ================================
// AI Configuration Service
// Manages API keys and provider configurations
// Stored as JSON for user-provided credentials
// ================================

import {
  AIConfig,
  LLMProviderConfig,
  TranscriptionProviderConfig,
  AIFeatureSettings,
  ProviderHealthCheck,
  DEFAULT_AI_CONFIG,
  DEFAULT_AI_FEATURE_SETTINGS,
  LLM_PROVIDER_PRESETS,
  TRANSCRIPTION_PROVIDER_PRESETS,
  AIProviderType,
  TranscriptionProviderType,
} from '../types/ai-providers';

// ================================
// Constants
// ================================

const AI_CONFIG_FILE = 'ai-config.json';
const CONFIG_VERSION = 1;

// ================================
// Utility Functions
// ================================

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Simple encryption for API keys (base64 + reverse)
 * Note: This is NOT secure encryption, just obfuscation
 * For production, use proper encryption with electron-store or keytar
 */
function obfuscateKey(key: string): string {
  if (!key) return '';
  const base64 = btoa(key);
  return base64.split('').reverse().join('');
}

/**
 * Deobfuscate API key
 */
function deobfuscateKey(obfuscated: string): string {
  if (!obfuscated) return '';
  try {
    const base64 = obfuscated.split('').reverse().join('');
    return atob(base64);
  } catch {
    return obfuscated; // Return as-is if not obfuscated
  }
}

// ================================
// AI Configuration Service
// ================================

class AIConfigService {
  private config: AIConfig = DEFAULT_AI_CONFIG;
  private configPath: string = '';
  private healthChecks: Map<string, ProviderHealthCheck> = new Map();

  // ================================
  // Initialization
  // ================================

  /**
   * Initialize the service and load configuration
   */
  async initialize(): Promise<void> {
    try {
      const dataPath = await window.electron.ipcRenderer.invoke('get-data-path');
      this.configPath = `${dataPath}/${AI_CONFIG_FILE}`;

      // Check if config file exists
      const exists = await window.electron.ipcRenderer.invoke('path-exists', this.configPath);

      if (exists) {
        await this.loadConfig();
      } else {
        // Create default config
        this.config = {
          ...DEFAULT_AI_CONFIG,
          updatedAt: new Date().toISOString(),
        };
        await this.saveConfig();
      }

      console.log('[AIConfigService] Initialized successfully');
    } catch (error) {
      console.error('[AIConfigService] Initialization failed:', error);
      this.config = DEFAULT_AI_CONFIG;
    }
  }

  /**
   * Load configuration from file
   */
  private async loadConfig(): Promise<void> {
    try {
      const content = await window.electron.ipcRenderer.invoke('read-file', this.configPath);
      const parsed = JSON.parse(content as string);

      // Migration if needed
      if (parsed.version !== CONFIG_VERSION) {
        this.config = this.migrateConfig(parsed);
        await this.saveConfig();
      } else {
        this.config = parsed;
      }
    } catch (error) {
      console.error('[AIConfigService] Failed to load config:', error);
      this.config = DEFAULT_AI_CONFIG;
    }
  }

  /**
   * Save configuration to file
   */
  private async saveConfig(): Promise<void> {
    try {
      this.config.updatedAt = new Date().toISOString();
      const content = JSON.stringify(this.config, null, 2);
      await window.electron.ipcRenderer.invoke('write-file', this.configPath, content);
    } catch (error) {
      console.error('[AIConfigService] Failed to save config:', error);
      throw error;
    }
  }

  /**
   * Migrate old config to new version
   */
  private migrateConfig(oldConfig: Partial<AIConfig>): AIConfig {
    // Handle version migrations here
    return {
      ...DEFAULT_AI_CONFIG,
      ...oldConfig,
      version: CONFIG_VERSION,
      features: {
        ...DEFAULT_AI_FEATURE_SETTINGS,
        ...oldConfig.features,
      },
    };
  }

  // ================================
  // LLM Provider Management
  // ================================

  /**
   * Get all LLM providers
   */
  getLLMProviders(): LLMProviderConfig[] {
    return this.config.llmProviders.map((p) => ({
      ...p,
      apiKey: deobfuscateKey(p.apiKey),
    }));
  }

  /**
   * Get active LLM provider
   */
  getActiveLLMProvider(): LLMProviderConfig | null {
    if (!this.config.activeLLMProviderId) return null;
    const provider = this.config.llmProviders.find((p) => p.id === this.config.activeLLMProviderId);
    if (!provider) return null;
    return {
      ...provider,
      apiKey: deobfuscateKey(provider.apiKey),
    };
  }

  /**
   * Add a new LLM provider
   */
  async addLLMProvider(
    type: AIProviderType,
    config: Omit<LLMProviderConfig, 'id' | 'type' | 'createdAt' | 'updatedAt'>
  ): Promise<LLMProviderConfig> {
    const preset = LLM_PROVIDER_PRESETS.find((p) => p.type === type);
    const now = new Date().toISOString();

    const provider: LLMProviderConfig = {
      ...config,
      id: generateId(),
      type,
      apiKey: obfuscateKey(config.apiKey),
      baseUrl: config.baseUrl || preset?.defaultBaseUrl,
      models: config.models.length > 0 ? config.models : (preset?.availableModels as any) || [],
      createdAt: now,
      updatedAt: now,
    };

    this.config.llmProviders.push(provider);

    // Set as active if it's the first one
    if (!this.config.activeLLMProviderId) {
      this.config.activeLLMProviderId = provider.id;
    }

    await this.saveConfig();
    return {
      ...provider,
      apiKey: deobfuscateKey(provider.apiKey),
    };
  }

  /**
   * Update an LLM provider
   */
  async updateLLMProvider(
    id: string,
    updates: Partial<Omit<LLMProviderConfig, 'id' | 'type' | 'createdAt'>>
  ): Promise<LLMProviderConfig | null> {
    const index = this.config.llmProviders.findIndex((p) => p.id === id);
    if (index === -1) return null;

    const updatedProvider: LLMProviderConfig = {
      ...this.config.llmProviders[index],
      ...updates,
      apiKey: updates.apiKey
        ? obfuscateKey(updates.apiKey)
        : this.config.llmProviders[index].apiKey,
      updatedAt: new Date().toISOString(),
    };

    this.config.llmProviders[index] = updatedProvider;
    await this.saveConfig();

    return {
      ...updatedProvider,
      apiKey: deobfuscateKey(updatedProvider.apiKey),
    };
  }

  /**
   * Delete an LLM provider
   */
  async deleteLLMProvider(id: string): Promise<boolean> {
    const index = this.config.llmProviders.findIndex((p) => p.id === id);
    if (index === -1) return false;

    this.config.llmProviders.splice(index, 1);

    // Clear active if deleted
    if (this.config.activeLLMProviderId === id) {
      this.config.activeLLMProviderId = this.config.llmProviders[0]?.id;
    }

    await this.saveConfig();
    return true;
  }

  /**
   * Set active LLM provider
   */
  async setActiveLLMProvider(id: string): Promise<boolean> {
    const provider = this.config.llmProviders.find((p) => p.id === id);
    if (!provider) return false;

    this.config.activeLLMProviderId = id;
    await this.saveConfig();
    return true;
  }

  // ================================
  // Transcription Provider Management
  // ================================

  /**
   * Get all transcription providers
   */
  getTranscriptionProviders(): TranscriptionProviderConfig[] {
    return this.config.transcriptionProviders.map((p) => ({
      ...p,
      apiKey: deobfuscateKey(p.apiKey),
      appSecret: p.appSecret ? deobfuscateKey(p.appSecret) : undefined,
    }));
  }

  /**
   * Get active transcription provider
   */
  getActiveTranscriptionProvider(): TranscriptionProviderConfig | null {
    if (!this.config.activeTranscriptionProviderId) return null;
    const provider = this.config.transcriptionProviders.find(
      (p) => p.id === this.config.activeTranscriptionProviderId
    );
    if (!provider) return null;
    return {
      ...provider,
      apiKey: deobfuscateKey(provider.apiKey),
      appSecret: provider.appSecret ? deobfuscateKey(provider.appSecret) : undefined,
    };
  }

  /**
   * Add a new transcription provider
   */
  async addTranscriptionProvider(
    type: TranscriptionProviderType,
    config: Omit<TranscriptionProviderConfig, 'id' | 'type' | 'createdAt' | 'updatedAt'>
  ): Promise<TranscriptionProviderConfig> {
    const preset = TRANSCRIPTION_PROVIDER_PRESETS.find((p) => p.type === type);
    const now = new Date().toISOString();

    const provider: TranscriptionProviderConfig = {
      ...config,
      id: generateId(),
      type,
      apiKey: obfuscateKey(config.apiKey),
      appSecret: config.appSecret ? obfuscateKey(config.appSecret) : undefined,
      baseUrl: config.baseUrl || preset?.defaultBaseUrl,
      models: config.models.length > 0 ? config.models : (preset?.availableModels as any) || [],
      createdAt: now,
      updatedAt: now,
    };

    this.config.transcriptionProviders.push(provider);

    // Set as active if it's the first one
    if (!this.config.activeTranscriptionProviderId) {
      this.config.activeTranscriptionProviderId = provider.id;
    }

    await this.saveConfig();
    return {
      ...provider,
      apiKey: deobfuscateKey(provider.apiKey),
      appSecret: provider.appSecret ? deobfuscateKey(provider.appSecret) : undefined,
    };
  }

  /**
   * Update a transcription provider
   */
  async updateTranscriptionProvider(
    id: string,
    updates: Partial<Omit<TranscriptionProviderConfig, 'id' | 'type' | 'createdAt'>>
  ): Promise<TranscriptionProviderConfig | null> {
    const index = this.config.transcriptionProviders.findIndex((p) => p.id === id);
    if (index === -1) return null;

    const existingProvider = this.config.transcriptionProviders[index];
    const updatedProvider: TranscriptionProviderConfig = {
      ...existingProvider,
      ...updates,
      apiKey: updates.apiKey ? obfuscateKey(updates.apiKey) : existingProvider.apiKey,
      appSecret: updates.appSecret ? obfuscateKey(updates.appSecret) : existingProvider.appSecret,
      updatedAt: new Date().toISOString(),
    };

    this.config.transcriptionProviders[index] = updatedProvider;
    await this.saveConfig();

    return {
      ...updatedProvider,
      apiKey: deobfuscateKey(updatedProvider.apiKey),
      appSecret: updatedProvider.appSecret ? deobfuscateKey(updatedProvider.appSecret) : undefined,
    };
  }

  /**
   * Delete a transcription provider
   */
  async deleteTranscriptionProvider(id: string): Promise<boolean> {
    const index = this.config.transcriptionProviders.findIndex((p) => p.id === id);
    if (index === -1) return false;

    this.config.transcriptionProviders.splice(index, 1);

    // Clear active if deleted
    if (this.config.activeTranscriptionProviderId === id) {
      this.config.activeTranscriptionProviderId = this.config.transcriptionProviders[0]?.id;
    }

    await this.saveConfig();
    return true;
  }

  /**
   * Set active transcription provider
   */
  async setActiveTranscriptionProvider(id: string): Promise<boolean> {
    const provider = this.config.transcriptionProviders.find((p) => p.id === id);
    if (!provider) return false;

    this.config.activeTranscriptionProviderId = id;
    await this.saveConfig();
    return true;
  }

  // ================================
  // Feature Settings
  // ================================

  /**
   * Get feature settings
   */
  getFeatureSettings(): AIFeatureSettings {
    return { ...this.config.features };
  }

  /**
   * Update feature settings
   */
  async updateFeatureSettings(updates: Partial<AIFeatureSettings>): Promise<AIFeatureSettings> {
    this.config.features = {
      ...this.config.features,
      ...updates,
    };
    await this.saveConfig();
    return this.config.features;
  }

  // ================================
  // Health Checks
  // ================================

  /**
   * Test LLM provider connection
   */
  async testLLMProvider(providerId: string): Promise<ProviderHealthCheck> {
    const provider = this.getLLMProviders().find((p) => p.id === providerId);
    if (!provider) {
      return {
        providerId,
        status: 'error',
        errorMessage: 'Provider not found',
        lastChecked: new Date().toISOString(),
      };
    }

    const startTime = Date.now();

    try {
      // Make a simple API call to test the connection
      const response = await this.makeTestRequest(provider);
      const responseTime = Date.now() - startTime;

      const healthCheck: ProviderHealthCheck = {
        providerId,
        status: response.ok ? 'healthy' : 'error',
        responseTime,
        errorMessage: response.ok ? undefined : `HTTP ${response.status}`,
        lastChecked: new Date().toISOString(),
      };

      this.healthChecks.set(providerId, healthCheck);
      return healthCheck;
    } catch (error) {
      const healthCheck: ProviderHealthCheck = {
        providerId,
        status: 'error',
        responseTime: Date.now() - startTime,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date().toISOString(),
      };

      this.healthChecks.set(providerId, healthCheck);
      return healthCheck;
    }
  }

  /**
   * Make a test request to the provider
   */
  private async makeTestRequest(provider: LLMProviderConfig): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...provider.customHeaders,
    };

    switch (provider.type) {
      case 'openai':
      case 'deepseek':
      case 'moonshot':
        headers['Authorization'] = `Bearer ${provider.apiKey}`;
        break;
      case 'anthropic':
        headers['x-api-key'] = provider.apiKey;
        headers['anthropic-version'] = '2023-06-01';
        break;
      case 'zhipu':
        headers['Authorization'] = `Bearer ${provider.apiKey}`;
        break;
    }

    // Just check models endpoint for validation
    const baseUrl = provider.baseUrl || '';
    const modelsUrl =
      provider.type === 'anthropic'
        ? `${baseUrl}/messages` // Anthropic doesn't have /models
        : `${baseUrl}/models`;

    return fetch(modelsUrl, {
      method: provider.type === 'anthropic' ? 'POST' : 'GET',
      headers,
      body:
        provider.type === 'anthropic'
          ? JSON.stringify({
              model: 'claude-3-haiku-20240307',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'test' }],
            })
          : undefined,
      signal: AbortSignal.timeout(provider.timeout || 10000),
    });
  }

  /**
   * Get cached health check
   */
  getHealthCheck(providerId: string): ProviderHealthCheck | null {
    return this.healthChecks.get(providerId) || null;
  }

  // ================================
  // Utility Methods
  // ================================

  /**
   * Get available provider presets
   */
  getLLMProviderPresets() {
    return LLM_PROVIDER_PRESETS;
  }

  /**
   * Get available transcription provider presets
   */
  getTranscriptionProviderPresets() {
    return TRANSCRIPTION_PROVIDER_PRESETS;
  }

  /**
   * Check if any provider is configured
   */
  hasConfiguredProviders(): boolean {
    return (
      this.config.llmProviders.some((p) => p.enabled) ||
      this.config.transcriptionProviders.some((p) => p.enabled)
    );
  }

  /**
   * Export configuration (without sensitive data)
   */
  exportConfig(): Omit<AIConfig, 'llmProviders' | 'transcriptionProviders'> & {
    llmProviders: Array<Omit<LLMProviderConfig, 'apiKey'>>;
    transcriptionProviders: Array<Omit<TranscriptionProviderConfig, 'apiKey' | 'appSecret'>>;
  } {
    return {
      ...this.config,
      llmProviders: this.config.llmProviders.map(({ apiKey, ...rest }) => rest),
      transcriptionProviders: this.config.transcriptionProviders.map(
        ({ apiKey, appSecret, ...rest }) => rest
      ),
    };
  }

  /**
   * Get full config (for internal use)
   */
  getConfig(): AIConfig {
    return {
      ...this.config,
      llmProviders: this.getLLMProviders(),
      transcriptionProviders: this.getTranscriptionProviders(),
    };
  }
}

// ================================
// Singleton Export
// ================================

export const aiConfigService = new AIConfigService();

// Auto-initialize when imported
if (typeof window !== 'undefined' && window.electron) {
  aiConfigService.initialize().catch(console.error);
}

export default aiConfigService;

// ================================
// SettingsPanel 组件
// AI 服务和应用设置配置
// ================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Settings,
  Brain,
  Mic,
  Globe,
  ChevronRight,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Save,
  Palette,
  Keyboard,
} from 'lucide-react';
import { ConfirmDialog } from '../InputDialog';
import {
  AIProviderType,
  TranscriptionProviderType,
  LLMProviderConfig,
  TranscriptionProviderConfig,
  LLM_PROVIDER_PRESETS,
  TRANSCRIPTION_PROVIDER_PRESETS,
  AIFeatureSettings,
  ProviderHealthCheck,
} from '../../types/ai-providers';
import { aiConfigService } from '../../services/aiConfigService';
import { ThemeSettings } from '../ThemeSettings';
import styles from './SettingsPanel.module.scss';

// ================================
// 类型定义
// ================================

type SettingsTab = 'general' | 'ai' | 'transcription' | 'appearance' | 'shortcuts';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// ================================
// SettingsPanel 组件
// ================================

const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai');
  const [llmProviders, setLlmProviders] = useState<LLMProviderConfig[]>([]);
  const [transcriptionProviders, setTranscriptionProviders] = useState<
    TranscriptionProviderConfig[]
  >([]);
  const [featureSettings, setFeatureSettings] = useState<AIFeatureSettings | null>(null);
  const [healthChecks, setHealthChecks] = useState<Map<string, ProviderHealthCheck>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [showAddProvider, setShowAddProvider] = useState<'llm' | 'transcription' | null>(null);
  const [showApiKey, setShowApiKey] = useState<Set<string>>(new Set());

  // 删除操作的确认对话框状态
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const closeConfirmDialog = useCallback(() => {
    setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // 挂载时加载设置
  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const llm = aiConfigService.getLLMProviders();
      const transcription = aiConfigService.getTranscriptionProviders();
      const features = aiConfigService.getFeatureSettings();
      setLlmProviders(llm);
      setTranscriptionProviders(transcription);
      setFeatureSettings(features);
    } catch (error) {
      console.error('加载设置失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ================================
  // Provider 管理
  // ================================

  const handleTestProvider = async (providerId: string, _type: 'llm' | 'transcription') => {
    try {
      const result = await aiConfigService.testLLMProvider(providerId);
      setHealthChecks((prev) => new Map(prev).set(providerId, result));
    } catch (error) {
      console.error('测试失败:', error);
    }
  };

  const handleDeleteProvider = async (providerId: string, type: 'llm' | 'transcription') => {
    setConfirmDialog({
      isOpen: true,
      title: '删除 Provider',
      message: '确定要删除这个 Provider 吗？',
      onConfirm: async () => {
        try {
          if (type === 'llm') {
            await aiConfigService.deleteLLMProvider(providerId);
            setLlmProviders((prev) => prev.filter((p) => p.id !== providerId));
          } else {
            await aiConfigService.deleteTranscriptionProvider(providerId);
            setTranscriptionProviders((prev) => prev.filter((p) => p.id !== providerId));
          }
        } catch (error) {
          console.error('删除失败:', error);
        }
        closeConfirmDialog();
      },
    });
  };

  const toggleShowApiKey = (providerId: string) => {
    setShowApiKey((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  };

  // ================================
  // 渲染标签页
  // ================================

  const tabs: Array<{ id: SettingsTab; icon: React.ReactNode; label: string }> = [
    { id: 'general', icon: <Settings size={18} />, label: '通用' },
    { id: 'ai', icon: <Brain size={18} />, label: 'AI 服务' },
    { id: 'transcription', icon: <Mic size={18} />, label: '语音转写' },
    { id: 'appearance', icon: <Palette size={18} />, label: '外观' },
    { id: 'shortcuts', icon: <Keyboard size={18} />, label: '快捷键' },
  ];

  if (!isOpen) return null;

  return (
    <div className={styles.settingsPanelOverlay} onClick={onClose}>
      <div className={styles.settingsPanel} onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className={styles.settingsHeader}>
          <h2 className={styles.settingsTitle}>设置</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className={styles.settingsContent}>
          {/* 侧边栏 */}
          <div className={styles.settingsSidebar}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`${styles.sidebarTab} ${activeTab === tab.id ? styles.sidebarTabActive : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* 主内容区 */}
          <div className={styles.settingsMain}>
            {isLoading && (
              <div className={styles.settingsLoading}>
                <div className={styles.loadingSpinner} />
                <span>加载中...</span>
              </div>
            )}

            {!isLoading && activeTab === 'ai' && (
              <AISettingsTab
                providers={llmProviders}
                healthChecks={healthChecks}
                featureSettings={featureSettings}
                showApiKey={showApiKey}
                onTest={handleTestProvider}
                onDelete={handleDeleteProvider}
                onToggleApiKey={toggleShowApiKey}
                onAddProvider={() => setShowAddProvider('llm')}
              />
            )}

            {!isLoading && activeTab === 'transcription' && (
              <TranscriptionSettingsTab
                providers={transcriptionProviders}
                healthChecks={healthChecks}
                showApiKey={showApiKey}
                onTest={(id) => handleTestProvider(id, 'transcription')}
                onDelete={(id) => handleDeleteProvider(id, 'transcription')}
                onToggleApiKey={toggleShowApiKey}
                onAddProvider={() => setShowAddProvider('transcription')}
              />
            )}

            {!isLoading && activeTab === 'general' && <GeneralSettingsTab />}

            {!isLoading && activeTab === 'appearance' && <AppearanceSettingsTab />}

            {!isLoading && activeTab === 'shortcuts' && <ShortcutsSettingsTab />}
          </div>
        </div>

        {/* 添加 Provider 模态框 */}
        {showAddProvider && (
          <AddProviderModal
            type={showAddProvider}
            onClose={() => setShowAddProvider(null)}
            onSuccess={() => {
              loadSettings();
              setShowAddProvider(null);
            }}
          />
        )}

        {/* 确认对话框 */}
        <ConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          isDanger={true}
          onConfirm={confirmDialog.onConfirm}
          onCancel={closeConfirmDialog}
        />
      </div>
    </div>
  );
};

// ================================
// AI 设置标签页
// ================================

interface AISettingsTabProps {
  providers: LLMProviderConfig[];
  healthChecks: Map<string, ProviderHealthCheck>;
  featureSettings: AIFeatureSettings | null;
  showApiKey: Set<string>;
  onTest: (id: string, type: 'llm') => void;
  onDelete: (id: string, type: 'llm') => void;
  onToggleApiKey: (id: string) => void;
  onAddProvider: () => void;
}

const AISettingsTab: React.FC<AISettingsTabProps> = ({
  providers,
  healthChecks,
  featureSettings,
  showApiKey,
  onTest,
  onDelete,
  onToggleApiKey,
  onAddProvider,
}) => {
  return (
    <div className={styles.settingsTab}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>LLM 服务提供商</h3>
          <button className={styles.addBtn} onClick={onAddProvider}>
            <Plus size={14} />
            <span>添加</span>
          </button>
        </div>

        <p className={styles.sectionDescription}>
          配置 AI 模型服务，用于自动摘要、标签提取、智能问答等功能
        </p>

        {providers.length === 0 ? (
          <div className={styles.emptyState}>
            <Brain size={32} />
            <p>尚未配置 AI 服务</p>
            <button className={styles.addFirstBtn} onClick={onAddProvider}>
              <Plus size={14} />
              <span>添加第一个 Provider</span>
            </button>
          </div>
        ) : (
          <div className={styles.providerList}>
            {providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                healthCheck={healthChecks.get(provider.id)}
                showApiKey={showApiKey.has(provider.id)}
                onTest={() => onTest(provider.id, 'llm')}
                onDelete={() => onDelete(provider.id, 'llm')}
                onToggleApiKey={() => onToggleApiKey(provider.id)}
              />
            ))}
          </div>
        )}
      </div>

      {featureSettings && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>自动处理</h3>
          <p className={styles.sectionDescription}>配置 AI 自动处理功能</p>

          <div className={styles.settingsList}>
            <SettingToggle
              label="自动生成摘要"
              description="为新添加的内容自动生成摘要"
              checked={featureSettings.autoSummarize}
              onChange={() => {}}
            />
            <SettingToggle
              label="自动打标签"
              description="自动为内容提取和建议标签"
              checked={featureSettings.autoTag}
              onChange={() => {}}
            />
            <SettingToggle
              label="语义搜索"
              description="启用基于向量的语义搜索"
              checked={featureSettings.semanticSearch}
              onChange={() => {}}
            />
            <SettingToggle
              label="相关内容推荐"
              description="自动发现和推荐相关内容"
              checked={featureSettings.relatedSuggestions}
              onChange={() => {}}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ================================
// 语音转写设置标签页
// ================================

interface TranscriptionSettingsTabProps {
  providers: TranscriptionProviderConfig[];
  healthChecks: Map<string, ProviderHealthCheck>;
  showApiKey: Set<string>;
  onTest: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleApiKey: (id: string) => void;
  onAddProvider: () => void;
}

const TranscriptionSettingsTab: React.FC<TranscriptionSettingsTabProps> = ({
  providers,
  healthChecks,
  showApiKey,
  onTest,
  onDelete,
  onToggleApiKey,
  onAddProvider,
}) => {
  return (
    <div className={styles.settingsTab}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>语音转写服务</h3>
          <button className={styles.addBtn} onClick={onAddProvider}>
            <Plus size={14} />
            <span>添加</span>
          </button>
        </div>

        <p className={styles.sectionDescription}>
          配置语音转写服务，支持 OpenAI Whisper、讯飞、Azure 等多种 Provider
        </p>

        {providers.length === 0 ? (
          <div className={styles.emptyState}>
            <Mic size={32} />
            <p>尚未配置语音转写服务</p>
            <button className={styles.addFirstBtn} onClick={onAddProvider}>
              <Plus size={14} />
              <span>添加第一个 Provider</span>
            </button>
          </div>
        ) : (
          <div className={styles.providerList}>
            {providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                healthCheck={healthChecks.get(provider.id)}
                showApiKey={showApiKey.has(provider.id)}
                onTest={() => onTest(provider.id)}
                onDelete={() => onDelete(provider.id)}
                onToggleApiKey={() => onToggleApiKey(provider.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>转写设置</h3>

        <div className={styles.settingsList}>
          <SettingToggle
            label="自动转写"
            description="自动转写新添加的音频文件"
            checked={true}
            onChange={() => {}}
          />
          <SettingToggle
            label="包含时间戳"
            description="在转写结果中包含时间戳"
            checked={true}
            onChange={() => {}}
          />
          <SettingSelect
            label="默认语言"
            description="转写时使用的默认语言"
            value="auto"
            options={[
              { value: 'auto', label: '自动检测' },
              { value: 'zh', label: '中文' },
              { value: 'en', label: '英文' },
              { value: 'ja', label: '日文' },
            ]}
            onChange={() => {}}
          />
        </div>
      </div>
    </div>
  );
};

// ================================
// 通用设置标签页
// ================================

const GeneralSettingsTab: React.FC = () => {
  return (
    <div className={styles.settingsTab}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>数据存储</h3>

        <div className={styles.settingsList}>
          <SettingInput
            label="数据目录"
            description="知识库数据的存储位置"
            value="~/Library/Application Support/code-reader"
            readOnly
            action={
              <button className={styles.inputAction}>
                <ExternalLink size={14} />
              </button>
            }
          />
          <SettingInput
            label="附件目录"
            description="图片、音频等附件的存储位置"
            value="~/Library/Application Support/code-reader/attachments"
            readOnly
          />
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>快速输入</h3>

        <div className={styles.settingsList}>
          <SettingInput
            label="全局快捷键"
            description="唤起快速输入窗口的快捷键"
            value="⌘ + N"
            readOnly
          />
          <SettingSelect
            label="默认输入类型"
            description="打开快速输入时的默认类型"
            value="text"
            options={[
              { value: 'text', label: '文字笔记' },
              { value: 'voice', label: '语音录入' },
              { value: 'image', label: '图片' },
              { value: 'url', label: '网址' },
            ]}
            onChange={() => {}}
          />
        </div>
      </div>
    </div>
  );
};

// ================================
// 外观设置标签页
// ================================

const AppearanceSettingsTab: React.FC = () => {
  return (
    <div className={styles.settingsTab}>
      <ThemeSettings />
    </div>
  );
};

// ================================
// 快捷键设置标签页
// ================================

const ShortcutsSettingsTab: React.FC = () => {
  const shortcuts = [
    { action: '快速输入', shortcut: '⌘ N' },
    { action: '全局搜索', shortcut: '⌘ P' },
    { action: '切换侧边栏', shortcut: '⌘ B' },
    { action: '知识库模式', shortcut: '⌘ 1' },
    { action: '写作模式', shortcut: '⌘ 2' },
    { action: '阅读模式', shortcut: '⌘ 3' },
    { action: '专注模式', shortcut: '⌘ ⇧ F' },
    { action: '设置', shortcut: '⌘ ,' },
  ];

  return (
    <div className={styles.settingsTab}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>键盘快捷键</h3>
        <p className={styles.sectionDescription}>查看和自定义键盘快捷键</p>

        <div className={styles.shortcutsList}>
          {shortcuts.map((item) => (
            <div key={item.action} className={styles.shortcutItem}>
              <span className={styles.shortcutAction}>{item.action}</span>
              <kbd className={styles.shortcutKey}>{item.shortcut}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ================================
// Provider 卡片组件
// ================================

interface ProviderCardProps {
  provider: LLMProviderConfig | TranscriptionProviderConfig;
  healthCheck?: ProviderHealthCheck;
  showApiKey: boolean;
  onTest: () => void;
  onDelete: () => void;
  onToggleApiKey: () => void;
}

const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  healthCheck,
  showApiKey,
  onTest,
  onDelete,
  onToggleApiKey,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const handleTest = async () => {
    setIsTesting(true);
    await onTest();
    setIsTesting(false);
  };

  const maskedKey = provider.apiKey
    ? `${provider.apiKey.slice(0, 4)}${'•'.repeat(20)}${provider.apiKey.slice(-4)}`
    : '未设置';

  return (
    <div
      className={`${styles.providerCard} ${provider.enabled ? '' : styles.providerCardDisabled}`}
    >
      <div className={styles.providerHeader} onClick={() => setIsExpanded(!isExpanded)}>
        <div className={styles.providerInfo}>
          <span className={styles.providerName}>{provider.name}</span>
          <span className={styles.providerType}>{provider.type}</span>
        </div>

        <div className={styles.providerStatus}>
          {healthCheck && (
            <span
              className={`${styles.statusBadge} ${styles[healthCheck.status]}`}
              title={healthCheck.errorMessage || `${healthCheck.responseTime}ms`}
            >
              {healthCheck.status === 'healthy' && <Check size={12} />}
              {healthCheck.status === 'error' && <AlertCircle size={12} />}
              {healthCheck.status === 'healthy' ? '正常' : '错误'}
            </span>
          )}
          <ChevronRight
            size={16}
            className={`${styles.expandIcon} ${isExpanded ? styles.expandIconExpanded : ''}`}
          />
        </div>
      </div>

      {isExpanded && (
        <div className={styles.providerDetails}>
          <div className={styles.detailRow}>
            <label>API Key</label>
            <div className={styles.apiKeyField}>
              <input
                type={showApiKey ? 'text' : 'password'}
                value={showApiKey ? provider.apiKey : maskedKey}
                readOnly
              />
              <button onClick={onToggleApiKey}>
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {provider.baseUrl && (
            <div className={styles.detailRow}>
              <label>Base URL</label>
              <input type="text" value={provider.baseUrl} readOnly />
            </div>
          )}

          <div className={styles.detailActions}>
            <button className={styles.testBtn} onClick={handleTest} disabled={isTesting}>
              <RefreshCw size={14} className={isTesting ? styles.spinning : ''} />
              <span>{isTesting ? '测试中...' : '测试连接'}</span>
            </button>
            <button className={styles.deleteBtn} onClick={onDelete}>
              <Trash2 size={14} />
              <span>删除</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ================================
// 添加 Provider 模态框
// ================================

interface AddProviderModalProps {
  type: 'llm' | 'transcription';
  onClose: () => void;
  onSuccess: () => void;
}

const AddProviderModal: React.FC<AddProviderModalProps> = ({ type, onClose, onSuccess }) => {
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const presets = type === 'llm' ? LLM_PROVIDER_PRESETS : TRANSCRIPTION_PROVIDER_PRESETS;

  const selectedPresetData = presets.find((p) => p.type === selectedPreset);

  useEffect(() => {
    if (selectedPresetData) {
      setName(selectedPresetData.name);
      setBaseUrl(selectedPresetData.defaultBaseUrl);
    }
  }, [selectedPresetData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPreset || !apiKey) return;

    setIsSubmitting(true);
    try {
      if (type === 'llm') {
        await aiConfigService.addLLMProvider(selectedPreset as AIProviderType, {
          name,
          enabled: true,
          apiKey,
          baseUrl,
          models: [],
        });
      } else {
        await aiConfigService.addTranscriptionProvider(
          selectedPreset as TranscriptionProviderType,
          {
            name,
            enabled: true,
            apiKey,
            baseUrl,
            models: [],
          }
        );
      }
      onSuccess();
    } catch (error) {
      console.error('添加 Provider 失败:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={`${styles.modal} ${styles.addProviderModal}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h3>添加 {type === 'llm' ? 'AI 服务' : '语音转写服务'}</h3>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            {/* Provider 选择 */}
            <div className={styles.formGroup}>
              <label>选择服务商</label>
              <div className={styles.presetGrid}>
                {presets.map((preset) => (
                  <button
                    key={preset.type}
                    type="button"
                    className={`${styles.presetCard} ${selectedPreset === preset.type ? styles.presetCardSelected : ''}`}
                    onClick={() => setSelectedPreset(preset.type)}
                  >
                    <Globe size={20} />
                    <span className={styles.presetName}>{preset.name}</span>
                    <span className={styles.presetDesc}>{preset.description}</span>
                  </button>
                ))}
              </div>
            </div>

            {selectedPreset && (
              <>
                <div className={styles.formGroup}>
                  <label htmlFor="provider-name">名称</label>
                  <input
                    id="provider-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="为这个配置起个名字"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="api-key">
                    API Key <span className={styles.required}>*</span>
                  </label>
                  <input
                    id="api-key"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="输入 API Key"
                    required
                  />
                  {selectedPresetData?.docsUrl && (
                    <a
                      href={selectedPresetData.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.helpLink}
                    >
                      如何获取 API Key? <ExternalLink size={12} />
                    </a>
                  )}
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="base-url">Base URL (可选)</label>
                  <input
                    id="base-url"
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={selectedPresetData?.defaultBaseUrl || ''}
                  />
                </div>
              </>
            )}
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              取消
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={!selectedPreset || !apiKey || isSubmitting}
            >
              <Save size={14} />
              <span>{isSubmitting ? '保存中...' : '保存'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ================================
// 设置组件
// ================================

interface SettingToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const SettingToggle: React.FC<SettingToggleProps> = ({ label, description, checked, onChange }) => (
  <div className={styles.settingItem}>
    <div className={styles.settingInfo}>
      <span className={styles.settingLabel}>{label}</span>
      {description && <span className={styles.settingDescription}>{description}</span>}
    </div>
    <label className={styles.toggle}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={styles.toggleSlider} />
    </label>
  </div>
);

interface SettingSelectProps {
  label: string;
  description?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

const SettingSelect: React.FC<SettingSelectProps> = ({
  label,
  description,
  value,
  options,
  onChange,
}) => (
  <div className={styles.settingItem}>
    <div className={styles.settingInfo}>
      <span className={styles.settingLabel}>{label}</span>
      {description && <span className={styles.settingDescription}>{description}</span>}
    </div>
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);

interface SettingInputProps {
  label: string;
  description?: string;
  value: string;
  readOnly?: boolean;
  action?: React.ReactNode;
  onChange?: (value: string) => void;
}

const SettingInput: React.FC<SettingInputProps> = ({
  label,
  description,
  value,
  readOnly,
  action,
  onChange,
}) => (
  <div className={styles.settingItem}>
    <div className={styles.settingInfo}>
      <span className={styles.settingLabel}>{label}</span>
      {description && <span className={styles.settingDescription}>{description}</span>}
    </div>
    <div className={styles.settingInputWrapper}>
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
      />
      {action}
    </div>
  </div>
);

export default SettingsPanel;

// ================================
// SettingsPanel 组件
// AI 服务和应用设置配置
// AI 服务商配置的唯一数据源在主进程，经 aiConfigService 读写
// ================================

import React, { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
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
  SpellCheck,
} from 'lucide-react';
import { ConfirmDialog } from '../InputDialog';
import { AIProviderType, LLM_PROVIDER_PRESETS } from '../../types/ai-providers';
import type { AppSettings } from '../../types/knowledge';
import {
  aiConfigService,
  type AIConfigSnapshot,
  type AIConnectionTestResult,
  type AIProviderUpdate,
  type AIProviderView,
} from '../../services/aiConfigService';
import { settingsService } from '../../services/settingsService';
import { ThemeSettings } from '../ThemeSettings';
import { SettingSelect, SettingToggle } from './SettingControls';
import { SpellCheckSettings } from './SpellCheckSettings';
import styles from './SettingsPanel.module.scss';

// ================================
// 类型定义
// ================================

type SettingsTab = 'general' | 'ai' | 'transcription' | 'appearance' | 'editor' | 'shortcuts';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/** 自动处理开关，归属应用设置（AppSettings），由知识库在新增条目时据此创建处理任务 */
type AutoProcessingKey = 'autoSummarize' | 'autoTag' | 'autoTranscribe';

/** IPC 抛出的错误信息 */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ================================
// SettingsPanel 组件
// ================================

const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai');
  const aiConfig = useSyncExternalStore(aiConfigService.subscribe, aiConfigService.getSnapshot);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [testResults, setTestResults] = useState<Map<string, AIConnectionTestResult>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showAddProvider, setShowAddProvider] = useState(false);

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

  // 打开时从主进程与应用设置重新加载
  useEffect(() => {
    if (!isOpen) return;

    setIsLoading(true);
    setErrorMessage(null);
    Promise.all([aiConfigService.refresh(), settingsService.get()])
      .then(([, settings]) => setAppSettings(settings))
      .catch((error: unknown) => setErrorMessage(toErrorMessage(error)))
      .finally(() => setIsLoading(false));
  }, [isOpen]);

  /** 执行写操作并把失败原因展示给用户 */
  const runAction = useCallback(async (action: () => Promise<unknown>) => {
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }, []);

  // ================================
  // Provider 管理
  // ================================

  const handleTestProvider = useCallback(async (providerId: string) => {
    const result = await aiConfigService.testConnection(providerId);
    setTestResults((prev) => new Map(prev).set(providerId, result));
  }, []);

  const handleDeleteProvider = (provider: AIProviderView) => {
    setConfirmDialog({
      isOpen: true,
      title: '删除 Provider',
      message: `确定要删除「${provider.name}」吗？`,
      onConfirm: async () => {
        closeConfirmDialog();
        await runAction(() => aiConfigService.removeProvider(provider.id));
      },
    });
  };

  const handleSaveProvider = (providerId: string, updates: AIProviderUpdate) =>
    runAction(() => aiConfigService.updateProvider(providerId, updates));

  const handleAutoProcessingChange = (key: AutoProcessingKey, checked: boolean) =>
    runAction(async () => setAppSettings(await settingsService.update({ [key]: checked })));

  // ================================
  // 渲染标签页
  // ================================

  const tabs: Array<{ id: SettingsTab; icon: React.ReactNode; label: string }> = [
    { id: 'general', icon: <Settings size={18} />, label: '通用' },
    { id: 'ai', icon: <Brain size={18} />, label: 'AI 服务' },
    { id: 'transcription', icon: <Mic size={18} />, label: '语音转写' },
    { id: 'appearance', icon: <Palette size={18} />, label: '外观' },
    { id: 'editor', icon: <SpellCheck size={18} />, label: '编辑器' },
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
            {errorMessage && (
              <div className={styles.errorBanner}>
                <AlertCircle size={14} />
                <span>{errorMessage}</span>
              </div>
            )}

            {isLoading && (
              <div className={styles.settingsLoading}>
                <div className={styles.loadingSpinner} />
                <span>加载中...</span>
              </div>
            )}

            {!isLoading && activeTab === 'ai' && (
              <AISettingsTab
                config={aiConfig}
                testResults={testResults}
                appSettings={appSettings}
                onTest={handleTestProvider}
                onSave={handleSaveProvider}
                onDelete={handleDeleteProvider}
                onSetDefault={(id) => runAction(() => aiConfigService.setDefaultProvider(id))}
                onSetDefaultEmbedding={(id) =>
                  runAction(() => aiConfigService.setDefaultEmbeddingProvider(id))
                }
                onAddProvider={() => setShowAddProvider(true)}
                onAutoProcessingChange={handleAutoProcessingChange}
              />
            )}

            {!isLoading && activeTab === 'transcription' && (
              <TranscriptionSettingsTab
                config={aiConfig}
                appSettings={appSettings}
                onSetDefault={(id) =>
                  runAction(() => aiConfigService.setDefaultTranscriptionProvider(id))
                }
                onGoToProviders={() => setActiveTab('ai')}
                onAutoProcessingChange={handleAutoProcessingChange}
              />
            )}

            {!isLoading && activeTab === 'general' && <GeneralSettingsTab />}

            {!isLoading && activeTab === 'appearance' && <AppearanceSettingsTab />}

            {!isLoading && activeTab === 'editor' && <SpellCheckSettings />}

            {!isLoading && activeTab === 'shortcuts' && <ShortcutsSettingsTab />}
          </div>
        </div>

        {/* 添加 Provider 模态框 */}
        {showAddProvider && (
          <AddProviderModal
            onClose={() => setShowAddProvider(false)}
            onSuccess={() => setShowAddProvider(false)}
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
  config: AIConfigSnapshot;
  testResults: Map<string, AIConnectionTestResult>;
  appSettings: AppSettings | null;
  onTest: (id: string) => Promise<void>;
  onSave: (id: string, updates: AIProviderUpdate) => Promise<void>;
  onDelete: (provider: AIProviderView) => void;
  onSetDefault: (id: string) => void;
  onSetDefaultEmbedding: (id: string) => void;
  onAddProvider: () => void;
  onAutoProcessingChange: (key: AutoProcessingKey, checked: boolean) => void;
}

const AISettingsTab: React.FC<AISettingsTabProps> = ({
  config,
  testResults,
  appSettings,
  onTest,
  onSave,
  onDelete,
  onSetDefault,
  onSetDefaultEmbedding,
  onAddProvider,
  onAutoProcessingChange,
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
          配置 AI 模型服务，用于自动摘要、标签提取、向量检索、语音转写和智能问答
        </p>

        {config.providers.length === 0 ? (
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
            {config.providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                isDefault={provider.id === config.defaultProviderId}
                isDefaultEmbedding={provider.id === config.defaultEmbeddingProviderId}
                isDefaultTranscription={provider.id === config.defaultTranscriptionProviderId}
                testResult={testResults.get(provider.id)}
                onTest={() => onTest(provider.id)}
                onSave={(updates) => onSave(provider.id, updates)}
                onDelete={() => onDelete(provider)}
                onSetDefault={() => onSetDefault(provider.id)}
                onSetDefaultEmbedding={() => onSetDefaultEmbedding(provider.id)}
              />
            ))}
          </div>
        )}
      </div>

      {appSettings && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>自动处理</h3>
          <p className={styles.sectionDescription}>新增内容时自动交给 AI 处理</p>

          <div className={styles.settingsList}>
            <SettingToggle
              label="自动生成摘要"
              description="为新添加的内容自动生成摘要"
              checked={appSettings.autoSummarize}
              onChange={(checked) => onAutoProcessingChange('autoSummarize', checked)}
            />
            <SettingToggle
              label="自动打标签"
              description="自动为内容提取和建议标签"
              checked={appSettings.autoTag}
              onChange={(checked) => onAutoProcessingChange('autoTag', checked)}
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
  config: AIConfigSnapshot;
  appSettings: AppSettings | null;
  onSetDefault: (id: string) => void;
  onGoToProviders: () => void;
  onAutoProcessingChange: (key: AutoProcessingKey, checked: boolean) => void;
}

const TranscriptionSettingsTab: React.FC<TranscriptionSettingsTabProps> = ({
  config,
  appSettings,
  onSetDefault,
  onGoToProviders,
  onAutoProcessingChange,
}) => {
  const candidates = config.providers.filter((p) => p.transcriptionModel);

  return (
    <div className={styles.settingsTab}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>语音转写服务</h3>
        <p className={styles.sectionDescription}>
          转写通过 OpenAI 兼容的 audio/transcriptions 接口完成；在「AI 服务」中为服务商填写转写模型（如
          whisper-1）后即可在此选用
        </p>

        {candidates.length === 0 ? (
          <div className={styles.emptyState}>
            <Mic size={32} />
            <p>尚无配置了转写模型的服务商</p>
            <button className={styles.addFirstBtn} onClick={onGoToProviders}>
              <Brain size={14} />
              <span>前往 AI 服务</span>
            </button>
          </div>
        ) : (
          <div className={styles.settingsList}>
            <SettingSelect
              label="默认转写服务"
              description="语音条目转写时使用的服务商"
              value={config.defaultTranscriptionProviderId ?? ''}
              options={[
                ...(config.defaultTranscriptionProviderId ? [] : [{ value: '', label: '未选择' }]),
                ...candidates.map((p) => ({
                  value: p.id,
                  label: `${p.name} · ${p.transcriptionModel}${p.isEnabled ? '' : '（已停用）'}`,
                })),
              ]}
              onChange={(id) => id && onSetDefault(id)}
            />
          </div>
        )}
      </div>

      {appSettings && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>转写设置</h3>

          <div className={styles.settingsList}>
            <SettingToggle
              label="自动转写"
              description="自动转写新添加的音频文件"
              checked={appSettings.autoTranscribe}
              onChange={(checked) => onAutoProcessingChange('autoTranscribe', checked)}
            />
          </div>
        </div>
      )}
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

/** 卡片内可编辑的字段；apiKey 为空表示保留已保存的密钥，其余字段为空表示清除 */
interface ProviderDraft {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  embeddingModel: string;
  transcriptionModel: string;
  isEnabled: boolean;
}

const toDraft = (provider: AIProviderView): ProviderDraft => ({
  apiKey: '',
  baseUrl: provider.baseUrl ?? '',
  defaultModel: provider.defaultModel ?? '',
  embeddingModel: provider.embeddingModel ?? '',
  transcriptionModel: provider.transcriptionModel ?? '',
  isEnabled: provider.isEnabled,
});

const isDraftDirty = (draft: ProviderDraft, saved: ProviderDraft): boolean =>
  (Object.keys(draft) as Array<keyof ProviderDraft>).some((key) => draft[key] !== saved[key]);

interface ProviderCardProps {
  provider: AIProviderView;
  isDefault: boolean;
  isDefaultEmbedding: boolean;
  isDefaultTranscription: boolean;
  testResult?: AIConnectionTestResult;
  onTest: () => Promise<void>;
  onSave: (updates: AIProviderUpdate) => Promise<void>;
  onDelete: () => void;
  onSetDefault: () => void;
  onSetDefaultEmbedding: () => void;
}

const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  isDefault,
  isDefaultEmbedding,
  isDefaultTranscription,
  testResult,
  onTest,
  onSave,
  onDelete,
  onSetDefault,
  onSetDefaultEmbedding,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [draft, setDraft] = useState<ProviderDraft>(() => toDraft(provider));
  const savedDraft = toDraft(provider);
  const savedDraftKey = JSON.stringify(savedDraft);

  // 主进程中的已保存值变化后重置草稿；仅快照引用变化时保留未保存的编辑
  useEffect(() => {
    setDraft(JSON.parse(savedDraftKey) as ProviderDraft);
  }, [savedDraftKey]);

  const isDirty = isDraftDirty(draft, savedDraft);

  const updateDraft = <K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleTest = async () => {
    setIsTesting(true);
    try {
      await onTest();
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(draft);
    } finally {
      setIsSaving(false);
    }
  };

  const badges = [
    isDefault && '对话默认',
    isDefaultEmbedding && '向量默认',
    isDefaultTranscription && '转写默认',
  ].filter((badge): badge is string => Boolean(badge));

  return (
    <div
      className={`${styles.providerCard} ${provider.isEnabled ? '' : styles.providerCardDisabled}`}
    >
      <div className={styles.providerHeader} onClick={() => setIsExpanded(!isExpanded)}>
        <div className={styles.providerInfo}>
          <div className={styles.providerName}>{provider.name}</div>
          <div className={styles.providerType}>
            <span>{provider.type}</span>
            {badges.map((badge) => (
              <span key={badge} className={styles.defaultBadge}>
                {badge}
              </span>
            ))}
          </div>
        </div>

        <div className={styles.providerStatus}>
          {testResult && (
            <span
              className={`${styles.statusBadge} ${testResult.success ? styles.statusBadgeHealthy : styles.statusBadgeError}`}
              title={testResult.error ?? `${testResult.latencyMs}ms`}
            >
              {testResult.success ? <Check size={12} /> : <AlertCircle size={12} />}
              {testResult.success ? '正常' : '错误'}
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
            <label className={styles.detailLabel}>启用</label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                className={styles.toggleInput}
                checked={draft.isEnabled}
                onChange={(e) => updateDraft('isEnabled', e.target.checked)}
              />
              <span className={styles.toggleSlider} />
            </label>
          </div>

          <div className={styles.detailRow}>
            <label className={styles.detailLabel}>API Key</label>
            <div className={styles.apiKeyField}>
              <input
                type={showApiKey ? 'text' : 'password'}
                className={`${styles.detailInput} ${styles.apiKeyInput}`}
                value={draft.apiKey}
                onChange={(e) => updateDraft('apiKey', e.target.value)}
                placeholder={
                  provider.hasApiKey
                    ? '已保存，留空保持不变'
                    : provider.requiresApiKey
                      ? '未设置'
                      : '本地服务无需密钥'
                }
                autoComplete="off"
              />
              <button
                type="button"
                className={styles.apiKeyToggle}
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <ProviderDetailInput
            label="Base URL"
            value={draft.baseUrl}
            placeholder="使用服务商默认地址"
            onChange={(value) => updateDraft('baseUrl', value)}
          />
          <ProviderDetailInput
            label="对话模型"
            value={draft.defaultModel}
            placeholder="用于摘要、标签与问答"
            onChange={(value) => updateDraft('defaultModel', value)}
          />
          <ProviderDetailInput
            label="向量模型"
            value={draft.embeddingModel}
            placeholder="留空则不用于向量检索"
            onChange={(value) => updateDraft('embeddingModel', value)}
          />
          <ProviderDetailInput
            label="转写模型"
            value={draft.transcriptionModel}
            placeholder="留空则不用于语音转写"
            onChange={(value) => updateDraft('transcriptionModel', value)}
          />

          <div className={styles.detailActions}>
            <button
              className={`${styles.actionButton} ${styles.saveBtn}`}
              onClick={handleSave}
              disabled={!isDirty || isSaving}
            >
              <Save size={14} />
              <span>{isSaving ? '保存中...' : '保存'}</span>
            </button>
            <button
              className={`${styles.actionButton} ${styles.testBtn}`}
              onClick={handleTest}
              disabled={isTesting || isDirty}
              title={isDirty ? '请先保存修改' : undefined}
            >
              <RefreshCw size={14} className={isTesting ? styles.testBtnSpinning : ''} />
              <span>{isTesting ? '测试中...' : '测试连接'}</span>
            </button>
            {!isDefault && (
              <button
                className={`${styles.actionButton} ${styles.testBtn}`}
                onClick={onSetDefault}
                disabled={!provider.isEnabled}
              >
                设为对话默认
              </button>
            )}
            {!isDefaultEmbedding && provider.embeddingModel && (
              <button
                className={`${styles.actionButton} ${styles.testBtn}`}
                onClick={onSetDefaultEmbedding}
                disabled={!provider.isEnabled}
              >
                设为向量默认
              </button>
            )}
            <button className={`${styles.actionButton} ${styles.deleteBtn}`} onClick={onDelete}>
              <Trash2 size={14} />
              <span>删除</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

interface ProviderDetailInputProps {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}

const ProviderDetailInput: React.FC<ProviderDetailInputProps> = ({
  label,
  value,
  placeholder,
  onChange,
}) => (
  <div className={styles.detailRow}>
    <label className={styles.detailLabel}>{label}</label>
    <input
      type="text"
      className={styles.detailInput}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

// ================================
// 添加 Provider 模态框
// ================================

interface AddProviderModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const AddProviderModal: React.FC<AddProviderModalProps> = ({ onClose, onSuccess }) => {
  const [selectedPreset, setSelectedPreset] = useState<AIProviderType | null>(null);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [embeddingModel, setEmbeddingModel] = useState('');
  const [transcriptionModel, setTranscriptionModel] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const selectedPresetData = LLM_PROVIDER_PRESETS.find((p) => p.type === selectedPreset);
  const apiKeyRequired = selectedPresetData?.requiredFields.includes('apiKey') ?? true;

  const handleSelectPreset = (type: AIProviderType) => {
    const defaults = aiConfigService.getProviderDefaults(type);
    setSelectedPreset(type);
    setName(defaults.name);
    setBaseUrl(defaults.baseUrl ?? '');
    setDefaultModel(defaults.defaultModel ?? '');
    setEmbeddingModel(defaults.embeddingModel ?? '');
    setTranscriptionModel(defaults.transcriptionModel ?? '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPreset || (apiKeyRequired && !apiKey)) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await aiConfigService.addProvider({
        type: selectedPreset,
        name,
        apiKey,
        baseUrl,
        isEnabled: true,
        defaultModel,
        embeddingModel,
        transcriptionModel,
      });
      onSuccess();
    } catch (error) {
      setSubmitError(toErrorMessage(error));
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
          <h3>添加 AI 服务</h3>
          <button className={styles.modalCloseBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            {submitError && (
              <div className={styles.errorBanner}>
                <AlertCircle size={14} />
                <span>{submitError}</span>
              </div>
            )}

            {/* Provider 选择 */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>选择服务商</label>
              <div className={styles.presetGrid}>
                {LLM_PROVIDER_PRESETS.map((preset) => (
                  <button
                    key={preset.type}
                    type="button"
                    className={`${styles.presetCard} ${selectedPreset === preset.type ? styles.presetCardSelected : ''}`}
                    onClick={() => handleSelectPreset(preset.type)}
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
                <FormField
                  id="provider-name"
                  label="名称"
                  value={name}
                  placeholder="为这个配置起个名字"
                  onChange={setName}
                />

                <div className={styles.formGroup}>
                  <label htmlFor="api-key" className={styles.formLabel}>
                    API Key{' '}
                    {apiKeyRequired ? <span className={styles.formRequired}>*</span> : '(可选)'}
                  </label>
                  <input
                    id="api-key"
                    type="password"
                    className={styles.formInput}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={apiKeyRequired ? '输入 API Key' : '本地服务无需密钥'}
                    autoComplete="off"
                    required={apiKeyRequired}
                  />
                  {apiKeyRequired && selectedPresetData?.docsUrl && (
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

                <FormField
                  id="base-url"
                  label="Base URL (可选)"
                  value={baseUrl}
                  placeholder={selectedPresetData?.defaultBaseUrl ?? ''}
                  onChange={setBaseUrl}
                />
                <FormField
                  id="chat-model"
                  label="对话模型"
                  value={defaultModel}
                  placeholder={
                    selectedPreset === 'ollama'
                      ? '本地已拉取的模型名，如 qwen2.5:7b'
                      : '用于摘要、标签与问答'
                  }
                  onChange={setDefaultModel}
                />
                <FormField
                  id="embedding-model"
                  label="向量模型 (可选)"
                  value={embeddingModel}
                  placeholder="留空则不用于向量检索"
                  onChange={setEmbeddingModel}
                />
                <FormField
                  id="transcription-model"
                  label="转写模型 (可选)"
                  value={transcriptionModel}
                  placeholder="留空则不用于语音转写"
                  onChange={setTranscriptionModel}
                />
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
              disabled={!selectedPreset || (apiKeyRequired && !apiKey) || isSubmitting}
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

interface FormFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}

const FormField: React.FC<FormFieldProps> = ({ id, label, value, placeholder, onChange }) => (
  <div className={styles.formGroup}>
    <label htmlFor={id} className={styles.formLabel}>
      {label}
    </label>
    <input
      id={id}
      type="text"
      className={styles.formInput}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  </div>
);

// ================================
// 设置组件
// ================================

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
        className={styles.settingInput}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
      />
      {action}
    </div>
  </div>
);

export default SettingsPanel;

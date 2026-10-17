// ================================
// 应用设置服务
// 设置保存在数据目录下的 settings.json（与历史版本使用同一文件，升级后设置不丢失）
// ================================

import type { AppSettings } from '../types/knowledge';

const SETTINGS_FILENAME = 'settings.json';
const ATTACHMENTS_DIR = 'attachments';
/** 内置英语词典 */
export const DEFAULT_SPELLCHECK_DICTIONARY = 'builtin:en_US';

function createDefaultSettings(dataPath: string): AppSettings {
  return {
    language: 'zh-CN',
    theme: 'dark',
    dataPath,
    attachmentsPath: `${dataPath}/${ATTACHMENTS_DIR}`,
    enableAI: true,
    autoTranscribe: true,
    autoSummarize: true,
    autoTag: true,
    quickInputHotkey: 'CommandOrControl+Shift+N',
    defaultInputType: 'text',
    spellCheck: true,
    spellCheckDictionary: DEFAULT_SPELLCHECK_DICTIONARY,
    enableSync: false,
  };
}

class SettingsService {
  private settings: AppSettings | null = null;
  private loading: Promise<AppSettings> | null = null;

  /** 数据目录（主进程 userData） */
  async getDataPath(): Promise<string> {
    return (await window.electron.ipcRenderer.invoke('get-data-path')) as string;
  }

  /** 读取设置（首次读取时加载或创建文件） */
  async get(): Promise<AppSettings> {
    if (this.settings) return this.settings;
    if (!this.loading) {
      this.loading = this.load().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  /** 更新设置并写回文件 */
  async update(updates: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.get();
    this.settings = { ...current, ...updates };
    await this.save(this.settings);
    return this.settings;
  }

  private async load(): Promise<AppSettings> {
    const dataPath = await this.getDataPath();
    const path = `${dataPath}/${SETTINGS_FILENAME}`;
    const defaults = createDefaultSettings(dataPath);
    const exists = (await window.electron.ipcRenderer.invoke('path-exists', path)) as boolean;

    if (exists) {
      try {
        const raw = (await window.electron.ipcRenderer.invoke('read-file', path)) as string;
        // 合并默认值，兼容旧版本缺失的字段
        this.settings = { ...defaults, ...(JSON.parse(raw) as Partial<AppSettings>) };
        return this.settings;
      } catch (error) {
        console.error('[Settings] 设置文件损坏，使用默认设置:', error);
      }
    }

    this.settings = defaults;
    await this.save(defaults);
    return defaults;
  }

  private async save(settings: AppSettings): Promise<void> {
    const path = `${settings.dataPath}/${SETTINGS_FILENAME}`;
    await window.electron.ipcRenderer.invoke('write-file', path, JSON.stringify(settings, null, 2));
  }
}

export const settingsService = new SettingsService();

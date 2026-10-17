// ================================
// 文字识别语言（渲染进程单例）
// 语言列表来自主进程（资源目录中实际存在的 traineddata：内置 + 用户导入），
// 用户的选择保存在 localStorage；导入/删除语言数据后刷新列表，无需重启即可用于下一次识别。
// ================================

import type { OcrLanguageInfo } from '../types/electron';
import {
  loadOcrLanguageSelection,
  resolveOcrLanguages,
  saveOcrLanguageSelection,
  toggleOcrLanguage,
} from '../lib/reading/ocr';

export interface OcrLanguageSnapshot {
  languages: OcrLanguageInfo[];
  /** 实际用于识别的语言：所选且存在语言数据的（第一项为主语言） */
  active: string[];
  /** 语言列表已读取 */
  loaded: boolean;
  /** 读取语言列表失败的原因 */
  error: string | null;
}

class OcrLanguageService {
  private selected = loadOcrLanguageSelection();
  private snapshot: OcrLanguageSnapshot = { languages: [], active: [], loaded: false, error: null };
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): OcrLanguageSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private setLanguages(languages: OcrLanguageInfo[]): void {
    const active = resolveOcrLanguages(this.selected, languages.map((language) => language.code));
    this.snapshot = { languages, active, loaded: true, error: null };
    for (const listener of this.listeners) listener();
  }

  /** 重新读取资源目录中的语言数据（打开设置或开始识别时调用，直接放入目录的文件也能生效） */
  async refresh(): Promise<void> {
    try {
      this.setLanguages(await window.electron.ocr.listLanguages());
    } catch (error) {
      this.snapshot = { ...this.snapshot, loaded: true, error: error instanceof Error ? error.message : String(error) };
      for (const listener of this.listeners) listener();
    }
  }

  /** 切换某个语言是否参与识别（至少保留一个） */
  toggle(code: string): void {
    this.selected = toggleOcrLanguage(this.snapshot.active, code);
    saveOcrLanguageSelection(this.selected);
    this.setLanguages(this.snapshot.languages);
  }

  /** 导入语言数据（弹出文件选择框）；导入的语言自动加入识别 */
  async importLanguages(): Promise<void> {
    const imported = await window.electron.ocr.importLanguage();
    if (imported.length === 0) return;
    this.selected = [...new Set([...this.snapshot.active, ...imported.map((language) => language.code)])];
    saveOcrLanguageSelection(this.selected);
    await this.refresh();
  }

  /** 删除导入的语言数据（同名内置语言随之恢复可用） */
  async removeLanguage(code: string): Promise<void> {
    await window.electron.ocr.removeLanguage(code);
    await this.refresh();
  }
}

export const ocrLanguageService = new OcrLanguageService();

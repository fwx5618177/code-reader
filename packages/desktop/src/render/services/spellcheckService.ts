// ================================
// 拼写检查服务（渲染进程单例）
// 负责：读取设置、经 IPC 读取词典文件并交给 Worker 解析、缓存检查结果、
// 用户词典增删与会话内忽略、词典导入/删除/切换（热切换，无需重启）
// ================================

import type { SpellcheckDictionaryInfo } from '../types/electron';
import type { SpellChecker } from '../lib/spellcheck/types';
import type { SpellWorkerMethod, SpellWorkerMethods, SpellWorkerRequest, SpellWorkerResponse } from '../lib/spellcheck/protocol';
import { DEFAULT_SPELLCHECK_DICTIONARY, settingsService } from './settingsService';

export type SpellcheckStatus = 'idle' | 'loading' | 'ready' | 'error';

/** 供设置界面订阅的状态快照 */
export interface SpellcheckSnapshot {
  enabled: boolean;
  dictionaryId: string;
  dictionaries: SpellcheckDictionaryInfo[];
  /** 个人词典中的单词（按添加顺序） */
  userWords: string[];
  status: SpellcheckStatus;
  error: string | null;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class SpellcheckService implements SpellChecker {
  private snapshot: SpellcheckSnapshot = {
    enabled: false,
    dictionaryId: DEFAULT_SPELLCHECK_DICTIONARY,
    dictionaries: [],
    userWords: [],
    status: 'idle',
    error: null,
  };
  private readonly listeners = new Set<() => void>();
  private worker: Worker | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  /** 单词 → 是否正确；词典或用户词变化时经 resetCache 清空 */
  private readonly cache = new Map<string, boolean>();
  /** 缓存代次：每次清空缓存时递增，清空前发出的检查结果随之作废 */
  private cacheGeneration = 0;
  /** 会话内忽略的单词 */
  private readonly ignored = new Set<string>();
  /** 词典加载序号：只采用最后一次加载的结果 */
  private loadSeq = 0;
  private initialized: Promise<void> | null = null;

  // ======= 状态订阅 =======

  getSnapshot = (): SpellcheckSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private setSnapshot(patch: Partial<SpellcheckSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  // ======= 初始化 =======

  /** 读取设置与词典列表（只执行一次）；启用时加载词典 */
  init(): Promise<void> {
    if (!this.initialized) {
      this.initialized = (async () => {
        const settings = await settingsService.get();
        const [dictionaries, userWords] = await Promise.all([
          window.electron.spellcheck.listDictionaries(),
          window.electron.spellcheck.getUserWords(),
        ]);
        this.setSnapshot({
          enabled: settings.spellCheck,
          dictionaryId: settings.spellCheckDictionary,
          dictionaries,
          userWords,
        });
        if (settings.spellCheck) await this.loadDictionary();
      })().catch((error) => {
        this.setSnapshot({ status: 'error', error: errorMessage(error) });
      });
    }
    return this.initialized;
  }

  activate(): void {
    void this.init();
  }

  // ======= SpellChecker =======

  isActive(): boolean {
    return this.snapshot.enabled && this.snapshot.status === 'ready';
  }

  lookup(word: string): boolean | undefined {
    if (this.ignored.has(word)) return true;
    return this.cache.get(word);
  }

  async checkWords(words: string[]): Promise<void> {
    const generation = this.cacheGeneration;
    const unknown = [...new Set(words)].filter((word) => this.lookup(word) === undefined);
    if (unknown.length === 0) return;
    const misspelled = new Set(await this.call('check', { words: unknown }));
    // 检查期间词典或用户词发生变化：结果作废
    if (generation !== this.cacheGeneration) return;
    for (const word of unknown) this.cache.set(word, !misspelled.has(word));
  }

  suggest(word: string): Promise<string[]> {
    return this.call('suggest', { word });
  }

  async addToDictionary(word: string): Promise<void> {
    await window.electron.spellcheck.addUserWord(word);
    if (!this.snapshot.userWords.includes(word)) {
      this.setSnapshot({ userWords: [...this.snapshot.userWords, word] });
    }
    await this.call('addWords', { words: [word] });
    this.cache.set(word, true);
    this.notify();
  }

  /** 从个人词典移除单词：同时从已加载的词典中移除并清空缓存，编辑器随即重新检查（无需重启） */
  async removeFromDictionary(word: string): Promise<void> {
    await this.init();
    await window.electron.spellcheck.removeUserWord(word);
    this.setSnapshot({ userWords: this.snapshot.userWords.filter((existing) => existing !== word) });
    // 尚未创建 Worker 说明词典还没加载，之后加载时会使用更新后的词表
    if (this.worker) await this.call('removeWords', { words: [word] });
    this.resetCache();
    this.notify();
  }

  ignore(word: string): void {
    this.ignored.add(word);
    this.notify();
  }

  // ======= 设置 =======

  async setEnabled(enabled: boolean): Promise<void> {
    await this.init();
    await settingsService.update({ spellCheck: enabled });
    this.setSnapshot({ enabled });
    if (enabled && this.snapshot.status !== 'ready') await this.loadDictionary();
  }

  async selectDictionary(id: string): Promise<void> {
    await this.init();
    await settingsService.update({ spellCheckDictionary: id });
    this.setSnapshot({ dictionaryId: id });
    if (this.snapshot.enabled) await this.loadDictionary();
  }

  /** 导入词典（弹出文件选择框）；导入成功后切换到第一个导入的词典 */
  async importDictionary(): Promise<SpellcheckDictionaryInfo[]> {
    await this.init();
    const imported = await window.electron.spellcheck.importDictionary();
    if (imported.length === 0) return imported;
    await this.refreshDictionaries();
    await this.selectDictionary(imported[0].id);
    return imported;
  }

  async removeDictionary(id: string): Promise<void> {
    await this.init();
    await window.electron.spellcheck.removeDictionary(id);
    await this.refreshDictionaries();
    if (id === this.snapshot.dictionaryId) await this.selectDictionary(DEFAULT_SPELLCHECK_DICTIONARY);
  }

  private async refreshDictionaries(): Promise<void> {
    this.setSnapshot({ dictionaries: await window.electron.spellcheck.listDictionaries() });
  }

  // ======= 词典加载 =======

  private resetCache(): void {
    this.cacheGeneration++;
    this.cache.clear();
  }

  private async loadDictionary(): Promise<void> {
    const seq = ++this.loadSeq;
    const { dictionaryId, dictionaries } = this.snapshot;
    // 当前词典已被删除时回退到内置词典
    const id = dictionaries.some((d) => d.id === dictionaryId) ? dictionaryId : DEFAULT_SPELLCHECK_DICTIONARY;
    this.setSnapshot({ status: 'loading', error: null });
    try {
      const files = await window.electron.spellcheck.readDictionary(id);
      // 词表在读取词典文件之后取：期间增删的用户词也会生效；之后的增删按消息顺序在 load 之后执行
      await this.call('load', { aff: files.aff, dic: files.dic, userWords: this.snapshot.userWords });
      if (seq !== this.loadSeq) return;
      this.resetCache();
      this.setSnapshot({ status: 'ready', dictionaryId: id });
    } catch (error) {
      if (seq !== this.loadSeq) return;
      this.setSnapshot({ status: 'error', error: `词典加载失败：${errorMessage(error)}` });
    }
  }

  // ======= Worker 通信 =======

  private call<K extends SpellWorkerMethod>(
    method: K,
    params: SpellWorkerMethods[K]['params']
  ): Promise<SpellWorkerMethods[K]['result']> {
    const worker = (this.worker ??= this.createWorker());
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as SpellWorkerMethods[K]['result']),
        reject,
      });
      worker.postMessage({ id, method, params } as SpellWorkerRequest);
    });
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL('../lib/spellcheck/spellcheck.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<SpellWorkerResponse>) => {
      const response = event.data;
      const request = this.pending.get(response.id);
      if (!request) return;
      this.pending.delete(response.id);
      if (response.ok) request.resolve(response.result);
      else request.reject(new Error(response.error));
    };
    worker.onerror = (event) => {
      // Worker 崩溃：拒绝全部挂起请求，下次调用时重建
      const error = new Error(event.message || '拼写检查 Worker 出错');
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
      this.resetCache();
      this.setSnapshot({ status: 'error', error: error.message });
    };
    return worker;
  }
}

export const spellcheckService = new SpellcheckService();

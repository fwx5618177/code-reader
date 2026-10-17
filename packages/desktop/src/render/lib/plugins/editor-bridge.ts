// ================================
// 编辑器桥接
// 连接插件系统与真实编辑器：编辑器组件注册实例，最后注册（挂载）的为活动编辑器；
// 插件 API 一律作用于“当前活动编辑器”，没有活动编辑器时抛错。
// 界面交互（消息、输入框、选择列表、确认框）由 PluginHost 注册的 UIManager 提供。
// ================================

import type { Disposable, EditorAPI, UIAPI } from './types';

/** 编辑器实例接口（由 RichEditor 实现） */
export interface EditorInstance {
  getContent(): string;
  setContent(content: string): void;
  getSelection(): string;
  replaceSelection(text: string): void;
  insertText(text: string): void;
  getCursorPosition(): { line: number; column: number };
  setCursorPosition(line: number, column: number): void;
  focus(): void;
}

/** 界面管理器接口（由 PluginHost 实现） */
export type UIManager = UIAPI;

class EditorBridge {
  private static instance: EditorBridge | null = null;

  private editor: EditorInstance | null = null;
  private uiManager: UIManager | null = null;
  /** 活动编辑器切换或其内容变化 */
  private readonly changeListeners = new Set<() => void>();

  static getInstance(): EditorBridge {
    EditorBridge.instance ??= new EditorBridge();
    return EditorBridge.instance;
  }

  /** 注册编辑器实例并设为活动编辑器 */
  registerEditor(editor: EditorInstance): Disposable {
    this.editor = editor;
    this.emitChange();
    return {
      dispose: () => {
        if (this.editor !== editor) return;
        this.editor = null;
        this.emitChange();
      },
    };
  }

  /** 编辑器内容发生变化时由编辑器组件调用 */
  notifyContentChange(): void {
    this.emitChange();
  }

  registerUIManager(manager: UIManager): Disposable {
    this.uiManager = manager;
    return {
      dispose: () => {
        if (this.uiManager === manager) this.uiManager = null;
      },
    };
  }

  /** 当前活动编辑器（命令面板关闭后用于恢复焦点） */
  getEditor(): EditorInstance | null {
    return this.editor;
  }

  /** 创建作用于当前活动编辑器的 API */
  createEditorAPI(): EditorAPI {
    const active = (): EditorInstance => {
      if (!this.editor) throw new Error('没有活动的编辑器');
      return this.editor;
    };
    return {
      getContent: () => active().getContent(),
      setContent: (content) => active().setContent(content),
      getSelection: () => active().getSelection(),
      replaceSelection: (text) => active().replaceSelection(text),
      insertText: (text) => active().insertText(text),
      getCursorPosition: () => active().getCursorPosition(),
      setCursorPosition: (line, column) => active().setCursorPosition(line, column),
      onDidChange: (listener) => {
        this.changeListeners.add(listener);
        return { dispose: () => this.changeListeners.delete(listener) };
      },
    };
  }

  /** 创建界面交互 API；界面尚未就绪时抛错 */
  createUIAPI(): UIAPI {
    const manager = (): UIManager => {
      if (!this.uiManager) throw new Error('插件界面尚未就绪');
      return this.uiManager;
    };
    return {
      showMessage: (message, type) => manager().showMessage(message, type),
      showInput: (options) => manager().showInput(options),
      showQuickPick: (items, options) => manager().showQuickPick(items, options),
      showConfirm: (message) => manager().showConfirm(message),
    };
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch (error) {
        console.error('[EditorBridge] 变更监听器出错:', error);
      }
    }
  }
}

export function getEditorBridge(): EditorBridge {
  return EditorBridge.getInstance();
}

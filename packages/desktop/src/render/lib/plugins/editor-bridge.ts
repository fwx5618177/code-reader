// ================================
// 编辑器桥接
// 连接插件系统与真实编辑器：编辑器组件注册实例，分栏时可同时有多个；
// 注册时声明是否为活动编辑器，之后由聚焦的一栏调用 activate 切换；活动编辑器注销时
// 回落到最近一次活动的其余编辑器。
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

  /** 已注册的编辑器，按最近活动顺序排列，末尾为活动编辑器 */
  private readonly editors: EditorInstance[] = [];
  private uiManager: UIManager | null = null;
  /** 活动编辑器切换或其内容变化 */
  private readonly changeListeners = new Set<() => void>();

  static getInstance(): EditorBridge {
    EditorBridge.instance ??= new EditorBridge();
    return EditorBridge.instance;
  }

  /**
   * 注册编辑器实例：active 为 true 时设为活动编辑器，否则排在所有已注册编辑器之后备用
   */
  registerEditor(editor: EditorInstance, active = true): Disposable {
    const previous = this.getEditor();
    if (active) this.editors.push(editor);
    else this.editors.unshift(editor);
    if (this.getEditor() !== previous) this.emitChange();
    return {
      dispose: () => {
        const index = this.editors.indexOf(editor);
        if (index === -1) return;
        const wasActive = index === this.editors.length - 1;
        this.editors.splice(index, 1);
        if (wasActive) this.emitChange();
      },
    };
  }

  /** 把已注册的编辑器设为活动编辑器（分栏中聚焦的一栏） */
  activate(editor: EditorInstance): void {
    const index = this.editors.indexOf(editor);
    if (index === -1 || index === this.editors.length - 1) return;
    this.editors.splice(index, 1);
    this.editors.push(editor);
    this.emitChange();
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
    return this.editors[this.editors.length - 1] ?? null;
  }

  /** 创建作用于当前活动编辑器的 API */
  createEditorAPI(): EditorAPI {
    const active = (): EditorInstance => {
      const editor = this.getEditor();
      if (!editor) throw new Error('没有活动的编辑器');
      return editor;
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

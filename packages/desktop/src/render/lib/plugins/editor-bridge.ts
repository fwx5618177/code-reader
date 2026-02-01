// ================================
// 编辑器桥接模块
// 连接插件系统与真实编辑器实例
// ================================

import type { EditorAPI, UIAPI, Disposable } from './types';

// ================================
// 类型定义
// ================================

/** 编辑器实例接口 */
export interface EditorInstance {
  /** 获取编辑器内容 */
  getContent(): string;
  /** 设置编辑器内容 */
  setContent(content: string): void;
  /** 获取选中文本 */
  getSelection(): string;
  /** 替换选中文本 */
  replaceSelection(text: string): void;
  /** 插入文本 */
  insertText(text: string, position?: number): void;
  /** 获取光标位置 */
  getCursorPosition(): { line: number; column: number };
  /** 设置光标位置 */
  setCursorPosition(line: number, column: number): void;
  /** 注册编辑器扩展 */
  registerExtension?(extension: unknown): Disposable;
  /** 聚焦编辑器 */
  focus?(): void;
  /** 失焦编辑器 */
  blur?(): void;
}

/** UI 管理器接口 */
export interface UIManager {
  /** 显示消息 */
  showMessage(message: string, type?: 'info' | 'warning' | 'error'): void;
  /** 显示输入框 */
  showInput(options: { prompt?: string; placeholder?: string; value?: string }): Promise<
    string | undefined
  >;
  /** 显示选择框 */
  showQuickPick(items: string[], options?: { placeholder?: string }): Promise<string | undefined>;
  /** 显示确认对话框 */
  showConfirm(message: string): Promise<boolean>;
  /** 注册侧边栏视图 */
  registerSidebarView?(id: string, component: unknown): Disposable;
  /** 注册工具栏按钮 */
  registerToolbarButton?(
    button: { command: string; icon: string; tooltip?: string },
    handler: () => void
  ): Disposable;
}

/** 桥接配置 */
export interface EditorBridgeConfig {
  /** 是否启用调试日志 */
  debug?: boolean;
}

// ================================
// 编辑器桥接实现
// ================================

/**
 * 编辑器桥接类
 * 管理编辑器实例和 UI 管理器的注册与访问
 */
class EditorBridge {
  /** 单例实例 */
  private static instance: EditorBridge | null = null;

  /** 当前编辑器实例 */
  private editor: EditorInstance | null = null;

  /** UI 管理器 */
  private uiManager: UIManager | null = null;

  /** 配置 */
  private config: EditorBridgeConfig;

  /** 编辑器变更监听器 */
  private editorChangeListeners: Set<(editor: EditorInstance | null) => void> = new Set();

  /** 是否已销毁 */
  private destroyed = false;

  private constructor(config: EditorBridgeConfig = {}) {
    this.config = {
      debug: false,
      ...config,
    };
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: EditorBridgeConfig): EditorBridge {
    if (!EditorBridge.instance) {
      EditorBridge.instance = new EditorBridge(config);
    }
    return EditorBridge.instance;
  }

  /**
   * 重置单例实例（用于测试）
   */
  static resetInstance(): void {
    if (EditorBridge.instance) {
      EditorBridge.instance.destroy();
      EditorBridge.instance = null;
    }
  }

  /**
   * 注册编辑器实例
   */
  registerEditor(editor: EditorInstance): Disposable {
    if (this.destroyed) {
      throw new Error('EditorBridge 已销毁');
    }

    this.log('注册编辑器实例');
    this.editor = editor;

    // 通知监听器
    this.notifyEditorChange();

    return {
      dispose: () => {
        if (this.editor === editor) {
          this.log('注销编辑器实例');
          this.editor = null;
          this.notifyEditorChange();
        }
      },
    };
  }

  /**
   * 注册 UI 管理器
   */
  registerUIManager(manager: UIManager): Disposable {
    if (this.destroyed) {
      throw new Error('EditorBridge 已销毁');
    }

    this.log('注册 UI 管理器');
    this.uiManager = manager;

    return {
      dispose: () => {
        if (this.uiManager === manager) {
          this.log('注销 UI 管理器');
          this.uiManager = null;
        }
      },
    };
  }

  /**
   * 获取当前编辑器实例
   */
  getEditor(): EditorInstance | null {
    return this.editor;
  }

  /**
   * 获取 UI 管理器
   */
  getUIManager(): UIManager | null {
    return this.uiManager;
  }

  /**
   * 监听编辑器变更
   */
  onEditorChange(listener: (editor: EditorInstance | null) => void): Disposable {
    this.editorChangeListeners.add(listener);
    return {
      dispose: () => {
        this.editorChangeListeners.delete(listener);
      },
    };
  }

  /**
   * 创建 EditorAPI
   * 用于插件系统
   */
  createEditorAPI(): EditorAPI {
    const self = this;

    return {
      getContent(): string {
        const editor = self.editor;
        if (!editor) {
          self.log('警告: 编辑器未注册，getContent 返回空字符串');
          return '';
        }
        return editor.getContent();
      },

      setContent(content: string): void {
        const editor = self.editor;
        if (!editor) {
          self.log('警告: 编辑器未注册，setContent 被忽略');
          return;
        }
        editor.setContent(content);
      },

      getSelection(): string {
        const editor = self.editor;
        if (!editor) {
          self.log('警告: 编辑器未注册，getSelection 返回空字符串');
          return '';
        }
        return editor.getSelection();
      },

      replaceSelection(text: string): void {
        const editor = self.editor;
        if (!editor) {
          self.log('警告: 编辑器未注册，replaceSelection 被忽略');
          return;
        }
        editor.replaceSelection(text);
      },

      insertText(text: string, position?: number): void {
        const editor = self.editor;
        if (!editor) {
          self.log('警告: 编辑器未注册，insertText 被忽略');
          return;
        }
        editor.insertText(text, position);
      },

      getCursorPosition(): { line: number; column: number } {
        const editor = self.editor;
        if (!editor) {
          self.log('警告: 编辑器未注册，getCursorPosition 返回默认值');
          return { line: 1, column: 1 };
        }
        return editor.getCursorPosition();
      },

      setCursorPosition(line: number, column: number): void {
        const editor = self.editor;
        if (!editor) {
          self.log('警告: 编辑器未注册，setCursorPosition 被忽略');
          return;
        }
        editor.setCursorPosition(line, column);
      },

      registerExtension(extension: unknown): Disposable {
        const editor = self.editor;
        if (!editor || !editor.registerExtension) {
          self.log('警告: 编辑器未注册或不支持扩展，registerExtension 返回空 Disposable');
          return { dispose: () => {} };
        }
        return editor.registerExtension(extension);
      },
    };
  }

  /**
   * 创建 UIAPI
   * 用于插件系统
   */
  createUIAPI(): UIAPI {
    const self = this;

    return {
      showMessage(message: string, type?: 'info' | 'warning' | 'error'): void {
        const manager = self.uiManager;
        if (manager) {
          manager.showMessage(message, type);
        } else {
          // 降级到控制台输出
          switch (type) {
            case 'warning':
              console.warn(`[UI] ${message}`);
              break;
            case 'error':
              console.error(`[UI] ${message}`);
              break;
            default:
              console.info(`[UI] ${message}`);
          }
        }
      },

      async showInput(options: {
        prompt?: string;
        placeholder?: string;
        value?: string;
      }): Promise<string | undefined> {
        const manager = self.uiManager;
        if (manager) {
          return manager.showInput(options);
        }
        // 降级到 prompt
        return window.prompt(options.prompt || '', options.value || '') || undefined;
      },

      async showQuickPick(
        items: string[],
        options?: { placeholder?: string }
      ): Promise<string | undefined> {
        const manager = self.uiManager;
        if (manager) {
          return manager.showQuickPick(items, options);
        }
        // 降级到简单选择
        const message = options?.placeholder || '请选择一项：';
        const selected = window.prompt(`${message}\n${items.map((item, i) => `${i + 1}. ${item}`).join('\n')}`);
        if (selected) {
          const index = parseInt(selected, 10) - 1;
          if (index >= 0 && index < items.length) {
            return items[index];
          }
        }
        return undefined;
      },

      async showConfirm(message: string): Promise<boolean> {
        const manager = self.uiManager;
        if (manager) {
          return manager.showConfirm(message);
        }
        // 降级到 confirm
        return window.confirm(message);
      },

      registerSidebarView(id: string, component: unknown): Disposable {
        const manager = self.uiManager;
        if (manager && manager.registerSidebarView) {
          return manager.registerSidebarView(id, component);
        }
        self.log(`警告: UI 管理器未注册或不支持侧边栏，registerSidebarView(${id}) 被忽略`);
        return { dispose: () => {} };
      },

      registerToolbarButton(
        button: { command: string; icon: string; tooltip?: string },
        handler: () => void
      ): Disposable {
        const manager = self.uiManager;
        if (manager && manager.registerToolbarButton) {
          return manager.registerToolbarButton(button, handler);
        }
        self.log(`警告: UI 管理器未注册或不支持工具栏，registerToolbarButton(${button.command}) 被忽略`);
        return { dispose: () => {} };
      },
    };
  }

  /**
   * 检查编辑器是否已注册
   */
  hasEditor(): boolean {
    return this.editor !== null;
  }

  /**
   * 检查 UI 管理器是否已注册
   */
  hasUIManager(): boolean {
    return this.uiManager !== null;
  }

  /**
   * 销毁桥接
   */
  destroy(): void {
    if (this.destroyed) return;

    this.log('销毁 EditorBridge');
    this.destroyed = true;
    this.editor = null;
    this.uiManager = null;
    this.editorChangeListeners.clear();
  }

  /**
   * 检查是否已销毁
   */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * 通知编辑器变更
   */
  private notifyEditorChange(): void {
    for (const listener of this.editorChangeListeners) {
      try {
        listener(this.editor);
      } catch (error) {
        console.error('编辑器变更监听器执行错误:', error);
      }
    }
  }

  /**
   * 日志输出
   */
  private log(message: string, ...args: unknown[]): void {
    if (this.config.debug) {
      console.log(`[EditorBridge] ${message}`, ...args);
    }
  }
}

// ================================
// 工厂函数与导出
// ================================

/**
 * 获取编辑器桥接实例
 */
export function getEditorBridge(config?: EditorBridgeConfig): EditorBridge {
  return EditorBridge.getInstance(config);
}

/**
 * 创建编辑器 API
 * 便捷函数
 */
export function createEditorAPI(): EditorAPI {
  return getEditorBridge().createEditorAPI();
}

/**
 * 创建 UI API
 * 便捷函数
 */
export function createUIAPI(): UIAPI {
  return getEditorBridge().createUIAPI();
}

/**
 * 注册编辑器实例
 * 便捷函数
 */
export function registerEditor(editor: EditorInstance): Disposable {
  return getEditorBridge().registerEditor(editor);
}

/**
 * 注册 UI 管理器
 * 便捷函数
 */
export function registerUIManager(manager: UIManager): Disposable {
  return getEditorBridge().registerUIManager(manager);
}

export { EditorBridge };

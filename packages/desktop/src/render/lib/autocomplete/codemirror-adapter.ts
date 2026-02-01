// ================================
// CodeMirror 补全适配器
// 将 AutocompleteService 集成到 CodeMirror 编辑器
// ================================

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
  startCompletion,
  closeCompletion,
  acceptCompletion,
  moveCompletionSelection,
} from '@codemirror/autocomplete';
import { type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import {
  AutocompleteService,
  type CompletionItem,
  type CompletionContext as ServiceContext,
} from './autocomplete-service';

// ================================
// 类型定义
// ================================

/** 适配器配置选项 */
export interface CodeMirrorAdapterOptions {
  /** AutocompleteService 实例（可选，不提供则创建新实例） */
  service?: AutocompleteService;
  /** 是否启用模糊匹配 */
  fuzzy?: boolean;
  /** 最大结果数 */
  maxResults?: number;
  /** 触发补全的最小字符数 */
  minTriggerLength?: number;
  /** 防抖延迟（毫秒） */
  debounceMs?: number;
  /** 是否在输入时自动触发 */
  activateOnTyping?: boolean;
  /** 触发字符列表 */
  triggerCharacters?: string[];
  /** 补全项图标映射 */
  iconMap?: Record<string, string>;
  /** 自定义补全项渲染 */
  renderItem?: (item: CompletionItem, element: HTMLElement) => void;
  /** 当前语言（用于代码补全） */
  language?: string;
  /** 是否显示补全详情 */
  showDetail?: boolean;
  /** 是否显示补全文档 */
  showDocumentation?: boolean;
}

/** 默认配置 */
const DEFAULT_OPTIONS: Required<Omit<CodeMirrorAdapterOptions, 'service' | 'renderItem'>> = {
  fuzzy: true,
  maxResults: 50,
  minTriggerLength: 1,
  debounceMs: 100,
  activateOnTyping: true,
  triggerCharacters: [':', '#', '@', '/', '.'],
  iconMap: {
    keyword: '🔤',
    snippet: '📝',
    text: '📄',
    method: '🔧',
    function: '⚡',
    constructor: '🏗️',
    field: '📦',
    variable: '📌',
    class: '📦',
    interface: '📐',
    module: '📁',
    property: '🔖',
    unit: '📏',
    value: '💎',
    enum: '🏷️',
    color: '🎨',
    file: '📄',
    reference: '🔗',
    folder: '📁',
    event: '⚡',
    operator: '➕',
    constant: '🔒',
    emoji: '😀',
    tag: '🏷️',
  },
  language: '',
  showDetail: true,
  showDocumentation: true,
};

// ================================
// 适配器核心实现
// ================================

/**
 * CodeMirror 补全适配器
 * 将 AutocompleteService 集成到 CodeMirror
 */
export class CodeMirrorAutocompleteAdapter {
  /** AutocompleteService 实例 */
  private service: AutocompleteService;

  /** 配置选项 */
  private options: Required<Omit<CodeMirrorAdapterOptions, 'service' | 'renderItem'>> &
    Pick<CodeMirrorAdapterOptions, 'renderItem'>;

  /** 是否拥有 service 实例 */
  private ownsService: boolean;

  /** 当前语言 */
  private currentLanguage: string;

  /**
   * 构造函数
   * @param options 配置选项
   */
  constructor(options?: CodeMirrorAdapterOptions) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    if (options?.service) {
      this.service = options.service;
      this.ownsService = false;
    } else {
      this.service = new AutocompleteService({
        maxResults: this.options.maxResults,
        fuzzy: this.options.fuzzy,
        minTriggerLength: this.options.minTriggerLength,
        debounceMs: this.options.debounceMs,
      });
      this.ownsService = true;
    }

    this.currentLanguage = this.options.language;
  }

  /**
   * 获取 AutocompleteService 实例
   */
  getService(): AutocompleteService {
    return this.service;
  }

  /**
   * 设置当前语言
   */
  setLanguage(language: string): void {
    this.currentLanguage = language;
  }

  /**
   * 创建补全源
   */
  createCompletionSource(): CompletionSource {
    return async (context: CompletionContext): Promise<CompletionResult | null> => {
      // 获取光标前的文本
      const line = context.state.doc.lineAt(context.pos);
      const lineText = line.text;
      const column = context.pos - line.from;
      const textBefore = lineText.slice(0, column);
      const textAfter = lineText.slice(column);

      // 计算查询词
      const wordMatch = textBefore.match(/[\w\u4e00-\u9fa5:@#/.-]*$/);
      const query = wordMatch ? wordMatch[0] : '';

      // 检查是否应该触发补全
      if (!this.shouldTrigger(context, query, textBefore)) {
        return null;
      }

      // 构建服务上下文
      const serviceContext: ServiceContext = {
        query,
        position: {
          line: line.number,
          column: column + 1,
        },
        lineText,
        textBefore,
        textAfter,
        language: this.currentLanguage,
      };

      try {
        // 获取补全结果
        const result = await this.service.getCompletions(serviceContext);

        if (result.items.length === 0) {
          return null;
        }

        // 计算补全起始位置
        const from = context.pos - query.length;

        // 转换为 CodeMirror 补全项
        const options = result.items.map((item) => this.convertToCompletion(item));

        return {
          from,
          options,
          validFor: /^[\w\u4e00-\u9fa5:@#/.-]*$/,
        };
      } catch (error) {
        console.error('补全服务错误:', error);
        return null;
      }
    };
  }

  /**
   * 检查是否应该触发补全
   */
  private shouldTrigger(context: CompletionContext, query: string, textBefore: string): boolean {
    // 检查显式触发
    if (context.explicit) {
      return true;
    }

    // 检查最小触发长度
    if (query.length >= this.options.minTriggerLength) {
      return true;
    }

    // 检查触发字符
    if (textBefore.length > 0) {
      const lastChar = textBefore[textBefore.length - 1];
      if (this.options.triggerCharacters.includes(lastChar)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 将 CompletionItem 转换为 CodeMirror Completion
   */
  private convertToCompletion(item: CompletionItem): Completion {
    const completion: Completion = {
      label: item.label,
      apply: item.insertText || item.label,
      type: item.type,
      boost: this.calculateBoost(item),
    };

    // 添加详情
    if (this.options.showDetail && item.detail) {
      completion.detail = item.detail;
    }

    // 添加文档信息
    if (this.options.showDocumentation && item.documentation) {
      completion.info = item.documentation;
    }

    return completion;
  }

  /**
   * 计算补全项的优先级提升值
   */
  private calculateBoost(item: CompletionItem): number {
    // CodeMirror 的 boost 范围通常是 -99 到 99
    // 将我们的 priority (0-100) 映射到这个范围
    const priority = item.priority ?? 50;
    return Math.round((priority - 50) * 2);
  }

  /**
   * 创建 CodeMirror 扩展
   */
  createExtension(): Extension[] {
    const completionSource = this.createCompletionSource();

    const extensions: Extension[] = [
      autocompletion({
        override: [completionSource],
        activateOnTyping: this.options.activateOnTyping,
        maxRenderedOptions: this.options.maxResults,
        defaultKeymap: true,
        closeOnBlur: true,
        interactionDelay: this.options.debounceMs,
      }),
    ];

    return extensions;
  }

  /**
   * 创建快捷键绑定
   */
  createKeymap(): Extension {
    return keymap.of([
      // Ctrl/Cmd + Space 触发补全
      {
        key: 'Ctrl-Space',
        mac: 'Cmd-Space',
        run: startCompletion,
      },
      // Escape 关闭补全
      {
        key: 'Escape',
        run: closeCompletion,
      },
      // Tab 接受补全
      {
        key: 'Tab',
        run: acceptCompletion,
      },
      // 上下键选择
      {
        key: 'ArrowDown',
        run: (view) => {
          return moveCompletionSelection(true)(view);
        },
      },
      {
        key: 'ArrowUp',
        run: (view) => {
          return moveCompletionSelection(false)(view);
        },
      },
    ]);
  }

  /**
   * 销毁适配器
   */
  destroy(): void {
    if (this.ownsService) {
      this.service.destroy();
    }
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 CodeMirror 补全适配器
 */
export function createCodeMirrorAdapter(
  options?: CodeMirrorAdapterOptions
): CodeMirrorAutocompleteAdapter {
  return new CodeMirrorAutocompleteAdapter(options);
}

/**
 * 创建 CodeMirror 补全扩展
 * 便捷函数，直接返回可用的扩展
 */
export function createAutocompleteExtension(options?: CodeMirrorAdapterOptions): Extension[] {
  const adapter = createCodeMirrorAdapter(options);
  return [...adapter.createExtension(), adapter.createKeymap()];
}

/**
 * 创建带有自定义补全源的扩展
 * 允许混合多个补全源
 */
export function createMixedAutocompleteExtension(
  sources: CompletionSource[],
  options?: Omit<CodeMirrorAdapterOptions, 'service'>
): Extension {
  return autocompletion({
    override: sources,
    activateOnTyping: options?.activateOnTyping ?? true,
    maxRenderedOptions: options?.maxResults ?? 50,
    defaultKeymap: true,
    closeOnBlur: true,
    interactionDelay: options?.debounceMs ?? 100,
  });
}

// ================================
// 便捷补全源工厂
// ================================

/**
 * 创建 Markdown 补全源
 * 提供 Markdown 语法补全
 */
export function createMarkdownCompletionSource(service: AutocompleteService): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const line = context.state.doc.lineAt(context.pos);
    const lineText = line.text;
    const column = context.pos - line.from;
    const textBefore = lineText.slice(0, column);

    // Markdown 特殊触发
    const triggers = ['#', '`', '*', '_', '[', '!', '>', '-', '+', '1.', ':'];
    const shouldTrigger =
      context.explicit ||
      triggers.some((t) => textBefore.endsWith(t)) ||
      /\w{2,}$/.test(textBefore);

    if (!shouldTrigger) {
      return null;
    }

    const wordMatch = textBefore.match(/[\w\u4e00-\u9fa5#`*_\[!>:.-]*$/);
    const query = wordMatch ? wordMatch[0] : '';

    const serviceContext: ServiceContext = {
      query,
      position: { line: line.number, column: column + 1 },
      lineText,
      textBefore,
      textAfter: lineText.slice(column),
    };

    const result = await service.getCompletions(serviceContext);

    if (result.items.length === 0) {
      return null;
    }

    return {
      from: context.pos - query.length,
      options: result.items.map((item) => ({
        label: item.label,
        apply: item.insertText || item.label,
        type: item.type,
        detail: item.detail,
        info: item.documentation,
        boost: (item.priority ?? 50) - 50,
      })),
    };
  };
}

/**
 * 创建 Emoji 补全源
 * 在输入 : 后提供 Emoji 补全
 */
export function createEmojiCompletionSource(service: AutocompleteService): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);

    // 检查是否在 : 后输入
    const match = textBefore.match(/:(\w*)$/);
    if (!match && !context.explicit) {
      return null;
    }

    const query = match ? match[1] : '';
    const from = match ? context.pos - query.length - 1 : context.pos;

    const serviceContext: ServiceContext = {
      query: ':' + query,
      position: { line: line.number, column: context.pos - line.from + 1 },
      lineText: line.text,
      textBefore,
      textAfter: line.text.slice(context.pos - line.from),
      triggerCharacter: ':',
    };

    const result = await service.getCompletions(serviceContext);

    // 过滤只保留 emoji 类型
    const emojiItems = result.items.filter(
      (item) => item.type === 'emoji' || item.source === 'emoji'
    );

    if (emojiItems.length === 0) {
      return null;
    }

    return {
      from,
      options: emojiItems.map((item) => ({
        label: item.label,
        apply: item.insertText || item.label,
        type: 'emoji',
        detail: item.detail,
      })),
    };
  };
}

/**
 * 创建代码片段补全源
 */
export function createSnippetCompletionSource(
  service: AutocompleteService,
  language?: string
): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);

    const wordMatch = textBefore.match(/[\w.-]*$/);
    const query = wordMatch ? wordMatch[0] : '';

    if (query.length < 2 && !context.explicit) {
      return null;
    }

    const serviceContext: ServiceContext = {
      query,
      position: { line: line.number, column: context.pos - line.from + 1 },
      lineText: line.text,
      textBefore,
      textAfter: line.text.slice(context.pos - line.from),
      language,
    };

    const result = await service.getCompletions(serviceContext);

    // 过滤只保留 snippet 类型
    const snippetItems = result.items.filter(
      (item) => item.type === 'snippet' || item.source === 'snippet'
    );

    if (snippetItems.length === 0) {
      return null;
    }

    return {
      from: context.pos - query.length,
      options: snippetItems.map((item) => ({
        label: item.label,
        apply: item.insertText || item.label,
        type: 'snippet',
        detail: item.detail,
        info: item.documentation,
      })),
    };
  };
}

// ================================
// @code-reader/autocomplete-service
// CodeMirror 编辑器适配器
// 将 AutocompleteService 集成到 CodeMirror 编辑器
// ================================

import {
  autocompletion,
  type Completion,
  type CompletionContext as CMCompletionContext,
  type CompletionResult as CMCompletionResult,
  type CompletionSource,
  startCompletion,
  closeCompletion,
  acceptCompletion,
  moveCompletionSelection,
  snippet,
} from '@codemirror/autocomplete';
import { type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { AutocompleteService } from '../service/autocomplete-service';
import type {
  CompletionItem,
  CompletionContext,
  BaseAdapterOptions,
  IconMap,
  DEFAULT_ICON_MAP,
} from '../types';

// ================================
// 代码片段
// ================================

/**
 * 把 VS Code 风格的片段模板（$1、${1:默认值}、${1|a,b|}、$0）转成 CodeMirror snippet 模板：
 * 字面的 { } 加反斜杠转义；$0（最终光标位置）排在所有字段之后
 */
export function toCodeMirrorSnippet(body: string): string {
  let result = '';
  let index = 0;
  while (index < body.length) {
    const rest = body.slice(index);
    const placeholder = /^\$(?:(\d+)|\{(\d+)(?::([^}]*)|\|([^|}]*)\|)?\})/.exec(rest);
    if (placeholder) {
      const order = placeholder[1] ?? placeholder[2]!;
      const text = placeholder[3] ?? placeholder[4]?.split(',')[0] ?? '';
      const field = order === '0' ? '9999' : order;
      result += text ? `\${${field}:${text.replace(/[{}]/g, '\\$&')}}` : `\${${field}}`;
      index += placeholder[0].length;
      continue;
    }
    const char = body[index]!;
    if (char === '\\' && body[index + 1] === '$') {
      result += '$';
      index += 2;
      continue;
    }
    result += char === '{' || char === '}' ? `\\${char}` : char;
    index += 1;
  }
  return result;
}

/** 补全项的插入方式：含占位符的代码片段按 snippet 插入（Tab 在字段间跳转），其余直接插入文本 */
function completionApply(item: CompletionItem): Completion['apply'] {
  const text = item.insertText || item.label;
  return item.type === 'snippet' && /\$(?:\d|\{\d)/.test(text) ? snippet(toCodeMirrorSnippet(text)) : text;
}

// ================================
// 配置类型
// ================================

/** CodeMirror 适配器配置选项 */
export interface CodeMirrorAdapterOptions extends BaseAdapterOptions {
  /** AutocompleteService 实例（可选，不提供则创建新实例） */
  service?: AutocompleteService;
  /** 补全项图标映射 */
  iconMap?: IconMap;
  /** 自定义补全项渲染函数 */
  renderItem?: (item: CompletionItem, element: HTMLElement) => void;
}

/** 默认配置 */
const DEFAULT_OPTIONS: Required<Omit<CodeMirrorAdapterOptions, 'service' | 'renderItem' | 'iconMap'>> = {
  fuzzy: true,
  maxResults: 50,
  minTriggerLength: 1,
  debounceMs: 100,
  activateOnTyping: true,
  triggerCharacters: [':', '#', '@', '/', '.'],
  language: '',
  showDetail: true,
  showDocumentation: true,
};

// ================================
// CodeMirror 适配器类
// ================================

/**
 * CodeMirror 补全适配器
 * 将 AutocompleteService 集成到 CodeMirror 编辑器
 */
export class CodeMirrorAdapter {
  /** AutocompleteService 实例 */
  private service: AutocompleteService;

  /** 配置选项 */
  private options: Required<Omit<CodeMirrorAdapterOptions, 'service' | 'renderItem' | 'iconMap'>> &
    Pick<CodeMirrorAdapterOptions, 'renderItem' | 'iconMap'>;

  /** 是否拥有 service 实例（用于销毁时判断） */
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
   * @param language 语言标识
   */
  setLanguage(language: string): void {
    this.currentLanguage = language;
  }

  /**
   * 获取当前语言
   */
  getLanguage(): string {
    return this.currentLanguage;
  }

  /**
   * 创建补全源
   */
  createCompletionSource(): CompletionSource {
    return async (context: CMCompletionContext): Promise<CMCompletionResult | null> => {
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
      const serviceContext: CompletionContext = {
        query,
        position: {
          line: line.number,
          column: column + 1,
          offset: context.pos,
        },
        lineText,
        textBefore,
        textAfter,
        language: this.currentLanguage,
        editorType: 'codemirror',
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
        console.error('[CodeMirrorAdapter] 补全服务错误:', error);
        return null;
      }
    };
  }

  /**
   * 检查是否应该触发补全
   */
  private shouldTrigger(context: CMCompletionContext, query: string, textBefore: string): boolean {
    // 显式触发（如按 Ctrl+Space）
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
      apply: completionApply(item),
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
   * CodeMirror 的 boost 范围通常是 -99 到 99
   */
  private calculateBoost(item: CompletionItem): number {
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
        run: (view) => moveCompletionSelection(true)(view),
      },
      {
        key: 'ArrowUp',
        run: (view) => moveCompletionSelection(false)(view),
      },
    ]);
  }

  /**
   * 创建完整的扩展配置（包含补全源和快捷键）
   */
  createFullExtension(): Extension[] {
    return [...this.createExtension(), this.createKeymap()];
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
 * @param options 配置选项
 */
export function createCodeMirrorAdapter(options?: CodeMirrorAdapterOptions): CodeMirrorAdapter {
  return new CodeMirrorAdapter(options);
}

/**
 * 创建 CodeMirror 补全扩展
 * 便捷函数，直接返回可用的扩展
 * @param options 配置选项
 */
export function createCodeMirrorExtension(options?: CodeMirrorAdapterOptions): Extension[] {
  const adapter = createCodeMirrorAdapter(options);
  return adapter.createFullExtension();
}

// ================================
// 补全源工厂函数
// ================================

/**
 * 创建 Markdown 补全源
 * 提供 Markdown 语法补全
 * @param service AutocompleteService 实例
 */
export function createMarkdownCompletionSource(service: AutocompleteService): CompletionSource {
  return async (context: CMCompletionContext): Promise<CMCompletionResult | null> => {
    const line = context.state.doc.lineAt(context.pos);
    const lineText = line.text;
    const column = context.pos - line.from;
    const textBefore = lineText.slice(0, column);

    // Markdown 特殊触发字符
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

    const serviceContext: CompletionContext = {
      query,
      position: { line: line.number, column: column + 1, offset: context.pos },
      lineText,
      textBefore,
      textAfter: lineText.slice(column),
      editorType: 'codemirror',
    };

    const result = await service.getCompletions(serviceContext);

    if (result.items.length === 0) {
      return null;
    }

    return {
      from: context.pos - query.length,
      options: result.items.map((item) => ({
        label: item.label,
        apply: completionApply(item),
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
 * @param service AutocompleteService 实例
 */
export function createEmojiCompletionSource(service: AutocompleteService): CompletionSource {
  return async (context: CMCompletionContext): Promise<CMCompletionResult | null> => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);

    // 检查是否在 : 后输入
    const match = textBefore.match(/:(\w*)$/);
    if (!match && !context.explicit) {
      return null;
    }

    const query = match ? match[1] : '';
    const from = match ? context.pos - query.length - 1 : context.pos;

    const serviceContext: CompletionContext = {
      query: ':' + query,
      position: { line: line.number, column: context.pos - line.from + 1, offset: context.pos },
      lineText: line.text,
      textBefore,
      textAfter: line.text.slice(context.pos - line.from),
      triggerCharacter: ':',
      editorType: 'codemirror',
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
        apply: completionApply(item),
        type: 'emoji',
        detail: item.detail,
      })),
    };
  };
}

/**
 * 创建代码片段补全源
 * @param service AutocompleteService 实例
 * @param language 编程语言
 */
export function createSnippetCompletionSource(
  service: AutocompleteService,
  language?: string
): CompletionSource {
  return async (context: CMCompletionContext): Promise<CMCompletionResult | null> => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);

    const wordMatch = textBefore.match(/[\w.-]*$/);
    const query = wordMatch ? wordMatch[0] : '';

    if (query.length < 2 && !context.explicit) {
      return null;
    }

    const serviceContext: CompletionContext = {
      query,
      position: { line: line.number, column: context.pos - line.from + 1, offset: context.pos },
      lineText: line.text,
      textBefore,
      textAfter: line.text.slice(context.pos - line.from),
      language,
      editorType: 'codemirror',
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
        apply: completionApply(item),
        type: 'snippet',
        detail: item.detail,
        info: item.documentation,
      })),
    };
  };
}


/**
 * 创建混合补全扩展
 * 允许混合多个补全源
 * @param sources 补全源列表
 * @param options 配置选项
 */
export function createMixedCompletionExtension(
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

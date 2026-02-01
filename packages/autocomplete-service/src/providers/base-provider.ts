// ================================
// @code-reader/autocomplete-service
// 基础提供者抽象类
// ================================

import type {
  CompletionProvider,
  CompletionContext,
  CompletionItem,
  CompletionSourceType,
} from '../types';

/**
 * 基础补全提供者抽象类
 * 提供通用的补全逻辑和辅助方法
 */
export abstract class BaseProvider implements CompletionProvider {
  /** 提供者名称 */
  abstract readonly name: string;

  /** 提供者类型 */
  abstract readonly type: CompletionSourceType;

  /** 优先级（越高越优先） */
  readonly priority: number;

  /** 触发字符列表 */
  readonly triggerCharacters?: string[];

  constructor(priority: number = 50, triggerCharacters?: string[]) {
    this.priority = priority;
    this.triggerCharacters = triggerCharacters;
  }

  /**
   * 获取补全项（子类必须实现）
   */
  abstract getCompletions(context: CompletionContext): Promise<CompletionItem[]> | CompletionItem[];

  /**
   * 是否应该激活（可被子类重写）
   */
  shouldActivate(context: CompletionContext): boolean {
    // 如果有触发字符，检查是否匹配
    if (this.triggerCharacters && this.triggerCharacters.length > 0) {
      if (context.triggerCharacter) {
        return this.triggerCharacters.includes(context.triggerCharacter);
      }

      // 检查文本前缀是否以触发字符结尾
      const { textBefore } = context;
      if (textBefore.length > 0) {
        const lastChar = textBefore[textBefore.length - 1];
        if (this.triggerCharacters.includes(lastChar)) {
          return true;
        }
      }
    }

    // 默认激活
    return true;
  }

  /**
   * 销毁提供者（可被子类重写）
   */
  dispose(): void {
    // 默认无操作
  }

  // ================================
  // 辅助方法
  // ================================

  /**
   * 创建补全项
   */
  protected createItem(
    id: string,
    label: string,
    options?: Partial<Omit<CompletionItem, 'id' | 'label' | 'type'>>
  ): CompletionItem {
    return {
      id,
      label,
      type: this.type,
      source: this.name,
      ...options,
    };
  }

  /**
   * 计算匹配优先级
   * 基于查询与标签的匹配程度
   */
  protected calculatePriority(query: string, label: string, basePriority: number = 50): number {
    let priority = basePriority;
    const queryLower = query.toLowerCase();
    const labelLower = label.toLowerCase();

    // 精确匹配
    if (labelLower === queryLower) {
      priority += 50;
    }
    // 前缀匹配
    else if (labelLower.startsWith(queryLower)) {
      priority += 30;
    }
    // 包含匹配
    else if (labelLower.includes(queryLower)) {
      priority += 10;
    }

    // 首字母匹配加分
    if (labelLower[0] === queryLower[0]) {
      priority += 5;
    }

    // 长度相近加分
    const lengthDiff = Math.abs(label.length - query.length);
    if (lengthDiff <= 2) {
      priority += 5;
    }

    return Math.min(100, Math.max(0, priority));
  }

  /**
   * 过滤补全项
   * 根据查询过滤并排序
   */
  protected filterItems(
    items: CompletionItem[],
    query: string,
    options?: {
      maxResults?: number;
      caseSensitive?: boolean;
    }
  ): CompletionItem[] {
    const { maxResults = 50, caseSensitive = false } = options ?? {};
    const queryNorm = caseSensitive ? query : query.toLowerCase();

    // 过滤匹配项
    const filtered = items.filter((item) => {
      const filterText = item.filterText ?? item.label;
      const textNorm = caseSensitive ? filterText : filterText.toLowerCase();
      return textNorm.includes(queryNorm) || this.fuzzyMatch(queryNorm, textNorm);
    });

    // 计算优先级并排序
    const withPriority = filtered.map((item) => ({
      item,
      priority: this.calculatePriority(query, item.filterText ?? item.label, item.priority ?? 50),
    }));

    withPriority.sort((a, b) => b.priority - a.priority);

    // 更新优先级并返回
    return withPriority.slice(0, maxResults).map(({ item, priority }) => ({
      ...item,
      priority,
    }));
  }

  /**
   * 简单的模糊匹配
   * 检查 pattern 是否是 text 的子序列
   */
  protected fuzzyMatch(pattern: string, text: string): boolean {
    if (pattern.length === 0) return true;
    if (pattern.length > text.length) return false;

    let patternIdx = 0;
    for (let i = 0; i < text.length && patternIdx < pattern.length; i++) {
      if (text[i] === pattern[patternIdx]) {
        patternIdx++;
      }
    }

    return patternIdx === pattern.length;
  }

  /**
   * 从文本中提取单词
   */
  protected extractWord(text: string, position: number): string {
    let start = position;
    let end = position;

    // 向前查找单词开始
    while (start > 0 && this.isWordChar(text[start - 1])) {
      start--;
    }

    // 向后查找单词结束
    while (end < text.length && this.isWordChar(text[end])) {
      end++;
    }

    return text.substring(start, end);
  }

  /**
   * 检查字符是否是单词字符
   */
  protected isWordChar(char: string): boolean {
    return /[\w\u4e00-\u9fa5]/.test(char);
  }

  /**
   * 检查是否在代码块内
   */
  protected isInCodeBlock(context: CompletionContext): boolean {
    const { textBefore } = context;

    // 简单检查：统计代码块标记
    const codeBlockMatches = textBefore.match(/```/g);
    if (codeBlockMatches && codeBlockMatches.length % 2 === 1) {
      return true;
    }

    return false;
  }

  /**
   * 检查是否在行内代码内
   */
  protected isInInlineCode(context: CompletionContext): boolean {
    const { lineText, position } = context;
    const textBeforeOnLine = lineText.substring(0, position.column - 1);

    // 统计反引号
    const backtickMatches = textBeforeOnLine.match(/`/g);
    if (backtickMatches && backtickMatches.length % 2 === 1) {
      return true;
    }

    return false;
  }

  /**
   * 检查是否在链接内
   */
  protected isInLink(context: CompletionContext): boolean {
    const { textBefore } = context;

    // 检查是否在 [...](...) 结构内
    const lastBracket = textBefore.lastIndexOf('[');
    const lastCloseBracket = textBefore.lastIndexOf(']');

    if (lastBracket > lastCloseBracket) {
      return true;
    }

    const lastParen = textBefore.lastIndexOf('(');
    const lastCloseParen = textBefore.lastIndexOf(')');

    if (lastCloseBracket > 0 && lastParen === lastCloseBracket + 1 && lastParen > lastCloseParen) {
      return true;
    }

    return false;
  }
}

// ================================
// 语言注册系统 - 类型定义
//
// 类似 VSCode 的语言贡献点（contributes.languages）设计
// 支持动态注册语言的解析器、高亮规则、配置等
// ================================

import type {
  ASTNode,
  ParserConfig,
  ParseResult,
  IncrementalParseResult,
  TextChangeSet,
  ASTRoot,
} from '../types';
import type { LanguageConfiguration } from '@code-reader/syntax-parser';

export type { LanguageConfiguration, AutoClosingPair, IndentationRules, FoldingMarkers } from '@code-reader/syntax-parser';

// ================================
// 语言元信息
// ================================

/**
 * 语言标识
 *
 * 类似 VSCode 的 language identifier
 * @see https://code.visualstudio.com/docs/languages/identifiers
 */
export interface LanguageId {
  /** 唯一语言 ID（如 'javascript', 'latex', 'markdown'） */
  readonly id: string;
  /** 显示名称（如 'JavaScript', 'LaTeX', 'Markdown'） */
  readonly name: string;
  /** 语言别名 */
  readonly aliases?: readonly string[];
  /** 关联的文件扩展名（如 ['.js', '.jsx', '.mjs']） */
  readonly extensions: readonly string[];
  /** 关联的文件名模式（如 ['Makefile', 'Dockerfile']） */
  readonly filenames?: readonly string[];
  /** 关联的 MIME 类型 */
  readonly mimeTypes?: readonly string[];
  /** 语言图标（用于 UI 显示） */
  readonly icon?: string;
}

// ================================
// 语法高亮 Token 类型
// ================================

/**
 * 语法高亮 Token 分类
 *
 * 基于 TextMate scope 约定 + semantic tokens
 * @see https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide
 */
export type TokenKind =
  // 注释
  | 'comment'
  | 'comment.line'
  | 'comment.block'
  | 'comment.documentation'
  // 字符串
  | 'string'
  | 'string.quoted'
  | 'string.template'
  | 'string.regexp'
  | 'string.escape'
  // 数字
  | 'number'
  | 'number.integer'
  | 'number.float'
  | 'number.hex'
  // 关键字
  | 'keyword'
  | 'keyword.control'
  | 'keyword.operator'
  | 'keyword.modifier'
  | 'keyword.import'
  // 运算符
  | 'operator'
  | 'operator.arithmetic'
  | 'operator.comparison'
  | 'operator.logical'
  | 'operator.assignment'
  // 标识符
  | 'identifier'
  | 'identifier.function'
  | 'identifier.variable'
  | 'identifier.parameter'
  | 'identifier.property'
  | 'identifier.type'
  | 'identifier.class'
  | 'identifier.namespace'
  | 'identifier.constant'
  | 'identifier.enum'
  | 'identifier.interface'
  // 标点
  | 'punctuation'
  | 'punctuation.bracket'
  | 'punctuation.delimiter'
  | 'punctuation.separator'
  // 标签（HTML/XML/LaTeX）
  | 'tag'
  | 'tag.name'
  | 'tag.attribute'
  // LaTeX 特有
  | 'command'
  | 'command.section'
  | 'command.math'
  | 'environment'
  | 'environment.name'
  | 'math'
  | 'math.inline'
  | 'math.display'
  // 常规
  | 'text'
  | 'heading'
  | 'emphasis'
  | 'strong'
  | 'link'
  | 'meta'
  | 'invalid'
  | 'deprecated';

/**
 * 语法高亮 Token
 */
export interface HighlightToken {
  /** Token 分类 */
  readonly kind: TokenKind;
  /** 起始位置（字符偏移） */
  readonly from: number;
  /** 结束位置（字符偏移） */
  readonly to: number;
  /** Token 附加修饰符 */
  readonly modifiers?: readonly TokenModifier[];
}

/**
 * Token 修饰符
 */
export type TokenModifier =
  | 'declaration'
  | 'definition'
  | 'readonly'
  | 'static'
  | 'deprecated'
  | 'abstract'
  | 'async'
  | 'modification'
  | 'documentation'
  | 'defaultLibrary';

/**
 * 高亮结果
 */
export interface HighlightResult {
  /** Token 列表（按 from 排序） */
  readonly tokens: readonly HighlightToken[];
  /** 高亮处理耗时（毫秒） */
  readonly highlightTime: number;
}

// ================================
// AST 节点到 Token 的映射规则
// ================================

/**
 * 高亮规则：将 AST 节点类型映射到 TokenKind
 *
 * 类似 TextMate grammar rules，但基于 AST 而不是正则
 */
export interface HighlightRule {
  /** 匹配的 AST 节点类型（支持通配符 *） */
  readonly nodeType: string;
  /** 映射到的 Token 分类 */
  readonly tokenKind: TokenKind;
  /** 可选的匹配条件 */
  readonly when?: HighlightCondition;
  /** 子规则（递归匹配子节点） */
  readonly children?: readonly HighlightRule[];
}

/**
 * 高亮条件
 */
export interface HighlightCondition {
  /** 节点文本匹配（正则） */
  readonly textMatch?: string;
  /** 父节点类型 */
  readonly parentType?: string;
  /** 节点内容包含 */
  readonly contains?: string;
  /** 节点是否为叶节点 */
  readonly isLeaf?: boolean;
}

// ================================
// 解析器适配器接口
// ================================

/**
 * 统一解析器接口
 *
 * 所有解析器（Lezer/手写/未来其他）都必须实现此接口
 */
export interface ILanguageParser<T extends ASTNode = ASTNode> {
  /** 语言 ID */
  readonly languageId: string;

  /** 解析完整文档 */
  parse(content: string, config?: ParserConfig): ParseResult<T>;

  /** 增量解析 */
  parseIncremental(
    content: string,
    changes: TextChangeSet,
    previousAST: ASTRoot<T>,
    config?: ParserConfig
  ): IncrementalParseResult<T>;

  /** 清除缓存 */
  clearCache(): void;

  /** 销毁释放资源 */
  dispose(): void;
}

// ================================
// 语言贡献定义（Schema）
// ================================

/**
 * 语言贡献配置
 *
 * 这是注册一种语言所需的完整配置
 * 类似 VSCode 的 contributes.languages + contributes.grammars
 */
export interface LanguageContribution {
  /** 语言元信息 */
  readonly language: LanguageId;

  /** 解析器工厂：创建该语言的解析器实例 */
  readonly parserFactory: LanguageParserFactory;

  /** 语法高亮规则 */
  readonly highlightRules?: readonly HighlightRule[];

  /** 语言特有配置 */
  readonly configuration?: LanguageConfiguration;

  /** 依赖的其他语言（如 HTML 内嵌 CSS/JS） */
  readonly embeddedLanguages?: readonly string[];
}

/**
 * 解析器工厂
 */
export type LanguageParserFactory = (config?: ParserConfig) => ILanguageParser;

// ================================
// 注册表事件
// ================================

/**
 * 语言注册事件
 */
export interface LanguageRegistryEvent {
  readonly type: 'register' | 'unregister' | 'update';
  readonly languageId: string;
  readonly contribution?: LanguageContribution;
}

/**
 * 事件监听器
 */
export type LanguageRegistryListener = (event: LanguageRegistryEvent) => void;

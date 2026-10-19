// ================================
// 文本存储库 - 核心类型定义
//
// 提供文本缓冲区所需的所有类型定义
// ================================

// ================================
// 文本变更类型
// ================================

/** 单个文本变更操作 */
export interface TextChange {
  /** 变更起始位置（字符偏移量） */
  readonly from: number;
  /** 变更结束位置（字符偏移量，不包含） */
  readonly to: number;
  /** 插入的文本 */
  readonly insert: string;
  /** 被删除的文本（可选，用于撤销） */
  readonly deleted?: string;
}

/** 批量文本变更 */
export interface TextChangeSet {
  /** 变更列表（按位置排序） */
  readonly changes: readonly TextChange[];
  /** 变更前的文档长度 */
  readonly oldLength: number;
  /** 变更后的文档长度 */
  readonly newLength: number;
}

// ================================
// 位置类型
// ================================

/** 位置信息 */
export interface Position {
  /** 行号（从 0 开始） */
  readonly line: number;
  /** 列号（从 0 开始） */
  readonly column: number;
  /** 字符偏移量 */
  readonly offset: number;
}

/** 范围信息 */
export interface Range {
  /** 起始位置 */
  readonly start: Position;
  /** 结束位置 */
  readonly end: Position;
}

// ================================
// 文本缓冲区接口
// ================================

/** 文本缓冲区接口 */
export interface ITextBuffer {
  /** 获取文档总长度 */
  readonly length: number;
  /** 获取行数 */
  readonly lineCount: number;

  /** 获取完整文本 */
  toString(): string;

  /** 获取指定范围的文本 */
  slice(start: number, end?: number): string;

  /** 获取指定行的文本 */
  getLine(line: number): string;

  /** 获取指定行的起始偏移量 */
  getLineOffset(line: number): number;

  /** 根据偏移量获取位置 */
  positionAt(offset: number): Position;

  /** 根据位置获取偏移量 */
  offsetAt(position: Position): number;

  /** 应用批量变更（返回新实例） */
  apply(changes: TextChangeSet): ITextBuffer;

  /** 插入文本（返回新实例） */
  insert(offset: number, text: string): ITextBuffer;

  /** 删除文本（返回新实例） */
  delete(from: number, to: number): ITextBuffer;

  /** 替换文本（返回新实例） */
  replace(from: number, to: number, text: string): ITextBuffer;
}

// ================================
// 缓冲区类型
// ================================

/** 文本缓冲区类型 */
export type TextBufferType = 'piece-table' | 'rope' | 'gap-buffer';

/** Piece Table 配置 */
export interface PieceTableConfig {
  /** 初始文本 */
  initialContent?: string;
  /** 是否启用行缓存（加速行操作） */
  enableLineCache?: boolean;
}

/** Rope 配置 */
export interface RopeConfig {
  /** 初始文本 */
  initialContent?: string;
  /** 叶节点最大长度 */
  leafMaxLength?: number;
  /** 节点最大子节点数 */
  nodeMaxChildren?: number;
}

/** Gap Buffer 配置 */
export interface GapBufferConfig {
  /** 初始文本 */
  initialContent?: string;
  /** 初始空隙大小 */
  gapSize?: number;
  /** 空隙扩展因子 */
  growFactor?: number;
}

/** 通用缓冲区配置 */
export interface TextBufferConfig {
  /** 缓冲区类型 */
  type?: TextBufferType;
  /** 初始文本 */
  initialContent?: string;
  /** 是否启用行缓存（Piece Table） */
  enableLineCache?: boolean;
  /** 叶节点最大长度（Rope） */
  leafMaxLength?: number;
  /** 初始空隙大小（Gap Buffer） */
  gapSize?: number;
}

// ================================
// 性能特征
// ================================

/** 缓冲区性能特征 */
export interface BufferPerformanceProfile {
  /** 缓冲区类型 */
  type: TextBufferType;
  /** 插入复杂度 */
  insertComplexity: 'O(1)' | 'O(log n)' | 'O(n)';
  /** 删除复杂度 */
  deleteComplexity: 'O(1)' | 'O(log n)' | 'O(n)';
  /** 随机访问复杂度 */
  accessComplexity: 'O(1)' | 'O(log n)' | 'O(n)';
  /** 适合的内容长度范围（UTF-16 码元） */
  suitableForSize: {
    min: number;
    max: number;
  };
  /** 适合的编辑模式 */
  suitableForPattern: ('frequent-edit' | 'large-file' | 'local-edit' | 'multi-cursor')[];
  /** 描述 */
  description: string;
}

// ================================
// 行信息
// ================================

/** 行信息缓存 */
export interface LineCache {
  /** 缓存是否有效 */
  valid: boolean;
  /** 每行的起始偏移量 */
  lineStarts: number[];
  /** 总行数 */
  lineCount: number;
}

/** 行信息 */
export interface LineInfo {
  /** 行号（从 0 开始） */
  line: number;
  /** 行起始偏移量 */
  startOffset: number;
  /** 行结束偏移量（不含换行符） */
  endOffset: number;
  /** 行内容 */
  content: string;
}

// ================================
// 编辑历史（可选功能）
// ================================

/** 编辑操作记录 */
export interface EditOperation {
  /** 操作类型 */
  type: 'insert' | 'delete' | 'replace';
  /** 起始位置 */
  from: number;
  /** 结束位置 */
  to: number;
  /** 插入的文本 */
  insertedText: string;
  /** 删除的文本 */
  deletedText: string;
  /** 操作时间戳 */
  timestamp: number;
}

/** 编辑历史 */
export interface EditHistory {
  /** 撤销栈 */
  undoStack: EditOperation[];
  /** 重做栈 */
  redoStack: EditOperation[];
  /** 最大历史记录数 */
  maxSize: number;
}

// ================================
// 辅助类型
// ================================

/** 深只读类型 */
export type DeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

/** 深可选类型 */
export type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

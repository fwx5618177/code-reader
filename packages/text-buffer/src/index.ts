// ================================
// 文本存储库 - 主入口
//
// 提供高性能文本存储功能：
// - Piece Table：VS Code 使用，适合频繁编辑
// - Rope：Xi Editor / Lapce 使用，适合超大文件
// - Gap Buffer：Emacs 使用，适合局部密集编辑
//
// 使用场景：
// - 代码编辑器：语法高亮、自动补全、错误检查
// - LaTeX 编辑器：实时渲染、增量编译
// - Markdown 编辑器：实时预览、大文件编辑
// ================================

// ================================
// 类型导出
// ================================

export type {
  // 文本变更类型
  TextChange,
  TextChangeSet,
  Position,
  Range,
  // 文本缓冲区类型
  ITextBuffer,
  TextBufferType,
  TextBufferConfig,
  PieceTableConfig,
  RopeConfig,
  GapBufferConfig,
  // 性能特征
  BufferPerformanceProfile,
  // 行信息
  LineCache,
  LineInfo,
  // 编辑历史
  EditOperation,
  EditHistory,
  // 辅助类型
  DeepReadonly,
  DeepPartial,
} from './types';

// ================================
// 数据结构导出
// ================================

export { PieceTable, createPieceTable } from './piece-table';
export { Rope, createRope } from './rope';
export { GapBuffer, createGapBuffer } from './gap-buffer';

// ================================
// 重新导入用于工厂函数
// ================================

import type { ITextBuffer, TextBufferType, TextBufferConfig, BufferPerformanceProfile } from './types';
import { PieceTable, createPieceTable } from './piece-table';
import { Rope, createRope } from './rope';
import { GapBuffer, createGapBuffer } from './gap-buffer';

// ================================
// 性能特征配置
// ================================

/** 超过这个长度（UTF-16 码元，即 string.length）使用 Rope */
const ROPE_THRESHOLD = 10 * 1024 * 1024;

/** 各缓冲区类型的性能特征 */
export const BUFFER_PROFILES: Record<TextBufferType, BufferPerformanceProfile> = {
  'piece-table': {
    type: 'piece-table',
    insertComplexity: 'O(log n)',
    deleteComplexity: 'O(log n)',
    accessComplexity: 'O(n)',
    suitableForSize: {
      min: 0,
      max: ROPE_THRESHOLD,
    },
    suitableForPattern: ['frequent-edit', 'multi-cursor'],
    description: 'VS Code 使用，适合频繁编辑场景，支持高效撤销/重做',
  },
  'rope': {
    type: 'rope',
    insertComplexity: 'O(log n)',
    deleteComplexity: 'O(log n)',
    accessComplexity: 'O(log n)',
    suitableForSize: {
      min: ROPE_THRESHOLD,
      max: Infinity,
    },
    suitableForPattern: ['large-file'],
    description: 'Xi Editor / Lapce 使用，适合超大文件，O(log n) 随机访问',
  },
  'gap-buffer': {
    type: 'gap-buffer',
    insertComplexity: 'O(1)',
    deleteComplexity: 'O(1)',
    accessComplexity: 'O(1)',
    suitableForSize: {
      min: 0,
      max: 1024 * 1024,
    },
    suitableForPattern: ['local-edit'],
    description: 'Emacs 使用，适合局部密集编辑，简单高效',
  },
};

// ================================
// 工厂函数
// ================================

/**
 * 根据内容长度自动选择缓冲区类型
 * @param length 内容长度（UTF-16 码元，即 string.length；不需要先编码成字节）
 * @returns 推荐的缓冲区类型
 */
export function selectBufferType(length: number): TextBufferType {
  // 超大文件使用 Rope
  if (length > ROPE_THRESHOLD) {
    return 'rope';
  }
  // 默认使用 Piece Table
  return 'piece-table';
}

/**
 * 创建文本缓冲区
 * @param config 缓冲区配置
 * @returns 文本缓冲区实例
 */
export function createTextBuffer(config: TextBufferConfig): ITextBuffer {
  const { type = 'piece-table', initialContent = '', enableLineCache = true } = config;

  switch (type) {
    case 'piece-table':
      return createPieceTable(initialContent, enableLineCache);
    case 'rope':
      return createRope(initialContent, enableLineCache);
    case 'gap-buffer':
      return createGapBuffer(initialContent, enableLineCache);
    default: {
      // 类型穷尽检查
      const _exhaustive: never = type;
      throw new Error(`未知的缓冲区类型: ${_exhaustive}`);
    }
  }
}

/**
 * 自动选择最佳缓冲区类型并创建实例
 * @param content 初始内容
 * @param enableLineCache 是否启用行缓存
 * @returns 文本缓冲区实例
 */
export function createAutoBuffer(content: string = '', enableLineCache: boolean = true): ITextBuffer {
  const type = selectBufferType(content.length);
  return createTextBuffer({
    type,
    initialContent: content,
    enableLineCache,
  });
}

/**
 * 获取缓冲区类型的性能特征
 * @param type 缓冲区类型
 * @returns 性能特征
 */
export function getBufferProfile(type: TextBufferType): BufferPerformanceProfile {
  return BUFFER_PROFILES[type];
}

/**
 * 根据使用模式推荐缓冲区类型
 * @param pattern 使用模式
 * @param length 内容长度（UTF-16 码元）
 * @returns 推荐的缓冲区类型
 */
export function recommendBufferType(
  pattern: 'frequent-edit' | 'large-file' | 'local-edit' | 'multi-cursor',
  length: number
): TextBufferType {
  // 超大文件强制使用 Rope
  if (length > ROPE_THRESHOLD) {
    return 'rope';
  }

  // 根据使用模式推荐
  switch (pattern) {
    case 'large-file':
      return 'rope';
    case 'local-edit':
      return 'gap-buffer';
    case 'frequent-edit':
    case 'multi-cursor':
    default:
      return 'piece-table';
  }
}

// ================================
// 默认导出
// ================================

export default {
  // 数据结构
  PieceTable,
  Rope,
  GapBuffer,
  // 工厂函数
  createTextBuffer,
  createAutoBuffer,
  createPieceTable,
  createRope,
  createGapBuffer,
  // 工具函数
  selectBufferType,
  getBufferProfile,
  recommendBufferType,
  // 配置
  BUFFER_PROFILES,
};

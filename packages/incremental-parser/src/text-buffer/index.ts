// ================================
// 文本缓冲区模块 - 重新导出
//
// 注意：文本存储功能已迁移到 @code-reader/text-storage
// 此模块仅为向后兼容保留，新代码请直接使用 @code-reader/text-storage
//
// 迁移指南：
// 旧代码：import { PieceTable } from '@code-reader/incremental-parser/text-buffer';
// 新代码：import { PieceTable } from '@code-reader/text-storage';
// ================================

// ================================
// 从 @code-reader/text-storage 重新导出
// ================================

export {
  // 数据结构
  PieceTable,
  Rope,
  GapBuffer,
  // 工厂函数
  createPieceTable,
  createRope,
  createGapBuffer,
  createTextBuffer,
  createAutoBuffer,
  // 工具函数
  selectBufferType,
  // 配置
  BUFFER_PROFILES,
} from '@code-reader/text-storage';

// ================================
// 类型重新导出
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
  // 性能特征
  BufferPerformanceProfile,
} from '@code-reader/text-storage';

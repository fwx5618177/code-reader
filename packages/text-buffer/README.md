# @code-reader/text-buffer

高性能文本存储库，提供多种文本数据结构实现。

## 概述

本库专注于文本存储与编辑操作，提供三种业界成熟的文本数据结构：

- **Piece Table** - VS Code 使用，适合频繁编辑场景
- **Rope** - Xi Editor / Lapce 使用，适合超大文件
- **Gap Buffer** - Emacs 使用，适合局部密集编辑

## 安装

```bash
pnpm add @code-reader/text-buffer
```

## 快速开始

```typescript
import {
  createTextBuffer,
  createAutoBuffer,
  PieceTable,
  Rope,
  GapBuffer,
} from '@code-reader/text-buffer';

// 自动选择最佳数据结构（根据文件大小）
const buffer = createAutoBuffer(initialContent);

// 或指定类型
const pieceTable = createTextBuffer({
  type: 'piece-table',
  initialContent: 'Hello, World!',
  enableLineCache: true,
});

// 编辑操作（不可变，返回新实例）
const newBuffer = buffer
  .insert(5, ' beautiful')
  .delete(0, 5)
  .replace(0, 0, 'Hi');

// 获取内容
console.log(newBuffer.toString());
console.log(newBuffer.getLine(0));
console.log(newBuffer.slice(0, 10));

// 位置转换
const position = newBuffer.positionAt(15);
console.log(`行 ${position.line}, 列 ${position.column}`);
```

## 数据结构对比

| 数据结构 | 插入/删除 | 随机访问 | 内存效率 | 适用场景 |
|---------|----------|---------|---------|---------|
| Piece Table | O(log n) | O(n) 平均 | 高 | 频繁编辑、撤销/重做 |
| Rope | O(log n) | O(log n) | 中 | 超大文件（> 10MB）、并行处理 |
| Gap Buffer | O(1) 局部 | O(1) | 低 | 局部密集编辑、简单场景 |

### 自动选择策略

```typescript
import { selectBufferType, createAutoBuffer } from '@code-reader/text-buffer';

// 根据文件大小自动选择
const bufferType = selectBufferType(fileContent.length);
// > 10MB: 'rope'
// <= 10MB: 'piece-table'

// 或直接使用自动缓冲区
const buffer = createAutoBuffer(fileContent);
```

## API 参考

### ITextBuffer 接口

所有文本缓冲区都实现此接口：

```typescript
interface ITextBuffer {
  // 属性
  readonly length: number;      // 文档总长度
  readonly lineCount: number;   // 行数

  // 读取操作
  toString(): string;                         // 获取完整文本
  slice(start: number, end?: number): string; // 获取指定范围文本
  getLine(line: number): string;              // 获取指定行文本
  getLineOffset(line: number): number;        // 获取行起始偏移量

  // 位置转换
  positionAt(offset: number): Position;       // 偏移量 -> 行列
  offsetAt(position: Position): number;       // 行列 -> 偏移量

  // 编辑操作（不可变）
  apply(changes: TextChangeSet): ITextBuffer;              // 批量变更
  insert(offset: number, text: string): ITextBuffer;       // 插入
  delete(from: number, to: number): ITextBuffer;           // 删除
  replace(from: number, to: number, text: string): ITextBuffer; // 替换
}
```

### 类型定义

```typescript
// 文本变更
interface TextChange {
  readonly from: number;    // 起始位置
  readonly to: number;      // 结束位置
  readonly insert: string;  // 插入的文本
  readonly deleted?: string; // 被删除的文本（用于撤销）
}

// 批量变更
interface TextChangeSet {
  readonly changes: readonly TextChange[];
  readonly oldLength: number;
  readonly newLength: number;
}

// 位置信息
interface Position {
  readonly line: number;    // 行号（从 0 开始）
  readonly column: number;  // 列号（从 0 开始）
  readonly offset: number;  // 字符偏移量
}

// 范围信息
interface Range {
  readonly start: Position;
  readonly end: Position;
}
```

## 各数据结构详解

### Piece Table

**原理**：维护两个缓冲区（原始缓冲区 + 追加缓冲区）和一个 Piece 链表。编辑时只追加到添加缓冲区，修改 Piece 链表描述文档组成。

**优点**：
- 原始内容不可变，天然支持撤销/重做
- 内存占用低（共享只读缓冲区）
- 插入/删除 O(log n)

**缺点**：
- 随机访问需要遍历 Piece 链表

```typescript
import { PieceTable, createPieceTable } from '@code-reader/text-buffer';

const table = createPieceTable('Hello, World!', {
  enableLineCache: true,  // 启用行缓存加速行操作
});

const newTable = table.insert(7, 'beautiful ');
console.log(newTable.toString()); // "Hello, beautiful World!"
```

### Rope

**原理**：使用平衡树（通常是 B+ 树或 AVL 树）存储文本，每个节点包含一小段文本。

**优点**：
- 所有操作都是 O(log n)
- 适合超大文件
- 可并行处理不同子树

**缺点**：
- 内存开销较大
- 实现复杂

```typescript
import { Rope, createRope } from '@code-reader/text-buffer';

const rope = createRope(hugeFileContent); // > 10MB
const newRope = rope.insert(1000000, 'inserted text');
```

### Gap Buffer

**原理**：在光标位置维护一个"空隙"，插入时直接写入空隙，移动光标时移动空隙。

**优点**：
- 局部编辑 O(1)
- 实现简单
- 内存紧凑

**缺点**：
- 移动光标需要 O(n) 数据拷贝
- 不适合多光标

```typescript
import { GapBuffer, createGapBuffer } from '@code-reader/text-buffer';

const buffer = createGapBuffer('Hello, World!', {
  gapSize: 1024,  // 初始空隙大小
});
```

## 性能指标

| 操作 | Piece Table | Rope | Gap Buffer |
|-----|-------------|------|------------|
| 插入（1MB 文档） | < 1ms | < 1ms | < 1ms（局部）|
| 删除（1MB 文档） | < 1ms | < 1ms | < 1ms（局部）|
| 随机访问 | 2-5ms | < 1ms | < 0.1ms |
| 行查询（有缓存） | < 0.1ms | < 1ms | < 0.1ms |
| 内存占用（1MB） | ~1.2MB | ~1.5MB | ~1.1MB |

## 与其他模块集成

### 与 @code-reader/syntax-parser 配合

```typescript
import { createAutoBuffer } from '@code-reader/text-buffer';
import { createLezerParser } from '@code-reader/syntax-parser';
import { parser as latexParser } from '@lezer/latex';

// 创建文本缓冲区
const buffer = createAutoBuffer(fileContent);

// 创建解析器
const parser = createLezerParser({
  parser: latexParser,
  language: 'latex',
});

// 解析
const result = parser.parse(buffer.toString());

// 编辑后增量解析
const newBuffer = buffer.insert(100, 'new text');
const changes = {
  changes: [{ from: 100, to: 100, insert: 'new text' }],
  oldLength: buffer.length,
  newLength: newBuffer.length,
};

const incrementalResult = parser.parseIncremental(
  newBuffer.toString(),
  changes,
  result.ast
);
```

### 与 @code-reader/diff-algorithm 配合

```typescript
import { quickTextDiff } from '@code-reader/diff-algorithm';
import { createAutoBuffer } from '@code-reader/text-buffer';

// 使用 diff 算法计算变更
const diffResult = quickTextDiff(oldContent, newContent);

// 应用变更到缓冲区
const changes = diffResult.diffs.map(d => ({
  from: d.start,
  to: d.end,
  insert: d.text,
}));

const newBuffer = buffer.apply({ changes, oldLength, newLength });
```

## 设计原则

1. **不可变性**：所有编辑操作返回新实例，原实例不变
2. **类型安全**：完整的 TypeScript 类型定义
3. **高性能**：针对编辑器场景优化
4. **单一职责**：只负责文本存储，不涉及解析

## 许可证

MIT
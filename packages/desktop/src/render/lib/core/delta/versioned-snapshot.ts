// ================================
// VersionedSnapshot
// 版本化快照模块
// 支持 versionId + contentHash 双处理
// ================================

import { ContentHasher, createFastHasher } from './content-hasher';

/**
 * 版本化快照 - 带有版本号和内容哈希的不可变快照
 */
export interface VersionedSnapshot {
  /** 文档 ID */
  readonly documentId: string;
  /** 版本 ID（单调递增） */
  readonly versionId: number;
  /** 内容哈希（用于精确变更检测） */
  readonly contentHash: string;
  /** 标题 */
  readonly title: string;
  /** 内容 */
  readonly content: string;
  /** 创建时间戳 */
  readonly timestamp: number;
  /** 内容长度（字节） */
  readonly contentLength: number;
  /** 可选：父版本 ID（用于版本链） */
  readonly parentVersionId?: number;
  /** 可选：父版本哈希（用于验证版本链完整性） */
  readonly parentContentHash?: string;
}

/**
 * 快照比较结果
 */
export interface SnapshotCompareResult {
  /** 是否相同 */
  readonly isEqual: boolean;
  /** 版本是否相同 */
  readonly versionEqual: boolean;
  /** 内容是否相同 */
  readonly contentEqual: boolean;
  /** 版本差异（正数表示 a 更新） */
  readonly versionDiff: number;
  /** 是否可以快进合并 */
  readonly canFastForward: boolean;
  /** 是否存在冲突（不同版本相同哈希，或相同版本不同哈希） */
  readonly hasConflict: boolean;
  /** 冲突类型 */
  readonly conflictType?: 'version_mismatch' | 'hash_mismatch' | 'diverged';
}

/**
 * 快照验证结果
 */
export interface SnapshotValidationResult {
  /** 是否有效 */
  readonly isValid: boolean;
  /** 错误列表 */
  readonly errors: string[];
  /** 警告列表 */
  readonly warnings: string[];
}

/**
 * 版本向量条目（用于分布式版本追踪）
 */
export interface VersionVectorEntry {
  /** 客户端/节点 ID */
  readonly clientId: string;
  /** 该客户端的最新版本号 */
  readonly version: number;
}

/**
 * 版本向量（用于分布式场景的因果关系追踪）
 */
export interface VersionVector {
  /** 版本向量条目 */
  readonly entries: ReadonlyArray<VersionVectorEntry>;
  /** 逻辑时钟值 */
  readonly clock: number;
}

/**
 * 快照元数据（轻量级，用于列表显示等）
 */
export interface SnapshotMetadata {
  /** 文档 ID */
  readonly documentId: string;
  /** 版本 ID */
  readonly versionId: number;
  /** 内容哈希 */
  readonly contentHash: string;
  /** 时间戳 */
  readonly timestamp: number;
  /** 内容长度 */
  readonly contentLength: number;
  /** 标题摘要（前 100 个字符） */
  readonly titleSummary: string;
}

/**
 * 快照工厂配置
 */
export interface SnapshotFactoryConfig {
  /** 内容哈希器 */
  hasher?: ContentHasher;
  /** 是否自动计算内容长度 */
  autoCalculateLength?: boolean;
  /** 是否包含父版本信息 */
  includeParentInfo?: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_FACTORY_CONFIG: Required<SnapshotFactoryConfig> = {
  hasher: createFastHasher(),
  autoCalculateLength: true,
  includeParentInfo: true,
};

// ================================
// VersionedSnapshotFactory 类
// ================================

/**
 * VersionedSnapshotFactory - 版本化快照工厂
 *
 * 核心特性：
 * 1. **双重版本追踪**：versionId（排序）+ contentHash（精确检测）
 * 2. **高效比较**：先比较哈希，再比较版本
 * 3. **版本链支持**：记录父版本信息，支持版本历史
 * 4. **分布式就绪**：支持版本向量
 *
 * 使用示例：
 * ```typescript
 * const factory = new VersionedSnapshotFactory();
 *
 * // 创建快照
 * const snapshot = factory.create({
 *   documentId: 'doc-123',
 *   versionId: 1,
 *   title: '我的文档',
 *   content: '<p>Hello</p>',
 * });
 *
 * // 创建新版本
 * const newSnapshot = factory.createNext(snapshot, {
 *   title: '我的文档 v2',
 *   content: '<p>Hello World</p>',
 * });
 *
 * // 比较快照
 * const comparison = factory.compare(snapshot, newSnapshot);
 * ```
 */
export class VersionedSnapshotFactory {
  private readonly config: Required<SnapshotFactoryConfig>;
  private readonly hasher: ContentHasher;

  constructor(config: Partial<SnapshotFactoryConfig> = {}) {
    this.config = { ...DEFAULT_FACTORY_CONFIG, ...config };
    this.hasher = this.config.hasher;
  }

  // ================================
  // 创建快照
  // ================================

  /**
   * 创建新的版本化快照
   *
   * @param params 快照参数
   * @returns 版本化快照
   */
  create(params: {
    documentId: string;
    versionId: number;
    title: string;
    content: string;
    parentVersionId?: number;
    parentContentHash?: string;
    timestamp?: number;
  }): VersionedSnapshot {
    const { documentId, versionId, title, content, parentVersionId, parentContentHash, timestamp } =
      params;

    // 计算内容哈希（标题 + 内容的组合）
    const combinedContent = `${title}\n---\n${content}`;
    const hashResult = this.hasher.hash(combinedContent);

    return {
      documentId,
      versionId,
      contentHash: hashResult.hash,
      title,
      content,
      timestamp: timestamp ?? Date.now(),
      contentLength: hashResult.contentLength,
      ...(this.config.includeParentInfo && parentVersionId !== undefined && { parentVersionId }),
      ...(this.config.includeParentInfo &&
        parentContentHash !== undefined && { parentContentHash }),
    };
  }

  /**
   * 基于现有快照创建下一个版本
   *
   * @param previous 前一个快照
   * @param updates 更新内容
   * @returns 新的版本化快照
   */
  createNext(
    previous: VersionedSnapshot,
    updates: {
      title?: string;
      content?: string;
      versionId?: number;
    }
  ): VersionedSnapshot {
    const newTitle = updates.title ?? previous.title;
    const newContent = updates.content ?? previous.content;
    const newVersionId = updates.versionId ?? previous.versionId + 1;

    return this.create({
      documentId: previous.documentId,
      versionId: newVersionId,
      title: newTitle,
      content: newContent,
      parentVersionId: previous.versionId,
      parentContentHash: previous.contentHash,
    });
  }

  /**
   * 从现有数据重建快照（不重新计算哈希）
   *
   * @param data 快照数据
   * @returns 版本化快照
   */
  fromData(data: {
    documentId: string;
    versionId: number;
    contentHash: string;
    title: string;
    content: string;
    timestamp: number;
    contentLength: number;
    parentVersionId?: number;
    parentContentHash?: string;
  }): VersionedSnapshot {
    return { ...data };
  }

  // ================================
  // 比较快照
  // ================================

  /**
   * 比较两个快照
   *
   * @param a 快照 A
   * @param b 快照 B
   * @returns 比较结果
   */
  compare(a: VersionedSnapshot, b: VersionedSnapshot): SnapshotCompareResult {
    const versionEqual = a.versionId === b.versionId;
    const contentEqual = a.contentHash === b.contentHash;
    const versionDiff = a.versionId - b.versionId;

    // 判断是否可以快进合并
    const canFastForward =
      (b.parentVersionId === a.versionId && b.parentContentHash === a.contentHash) ||
      (a.parentVersionId === b.versionId && a.parentContentHash === b.contentHash);

    // 检测冲突
    let hasConflict = false;
    let conflictType: 'version_mismatch' | 'hash_mismatch' | 'diverged' | undefined;

    if (versionEqual && !contentEqual) {
      // 相同版本但内容不同：哈希不匹配
      hasConflict = true;
      conflictType = 'hash_mismatch';
    } else if (!versionEqual && contentEqual) {
      // 不同版本但内容相同：版本不匹配（可能是重复编辑）
      // 这不一定是冲突，只是需要注意
      conflictType = 'version_mismatch';
    } else if (
      !canFastForward &&
      a.parentVersionId !== undefined &&
      b.parentVersionId !== undefined &&
      a.parentVersionId !== b.versionId &&
      b.parentVersionId !== a.versionId
    ) {
      // 分叉：两个版本有不同的父版本
      hasConflict = true;
      conflictType = 'diverged';
    }

    return {
      isEqual: versionEqual && contentEqual,
      versionEqual,
      contentEqual,
      versionDiff,
      canFastForward,
      hasConflict,
      conflictType,
    };
  }

  /**
   * 检查快照是否比另一个更新
   *
   * @param snapshot 要检查的快照
   * @param other 比较对象
   * @returns 如果 snapshot 更新返回 true
   */
  isNewer(snapshot: VersionedSnapshot, other: VersionedSnapshot): boolean {
    // 先比较版本号
    if (snapshot.versionId !== other.versionId) {
      return snapshot.versionId > other.versionId;
    }

    // 版本号相同时比较时间戳
    return snapshot.timestamp > other.timestamp;
  }

  /**
   * 检查内容是否实际变化
   *
   * @param a 快照 A
   * @param b 快照 B
   * @returns 如果内容不同返回 true
   */
  hasContentChanged(a: VersionedSnapshot, b: VersionedSnapshot): boolean {
    return a.contentHash !== b.contentHash;
  }

  // ================================
  // 验证快照
  // ================================

  /**
   * 验证快照的完整性
   *
   * @param snapshot 要验证的快照
   * @returns 验证结果
   */
  validate(snapshot: VersionedSnapshot): SnapshotValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 检查必需字段
    if (!snapshot.documentId) {
      errors.push('缺少文档 ID');
    }

    if (typeof snapshot.versionId !== 'number' || snapshot.versionId < 0) {
      errors.push('版本 ID 必须是非负整数');
    }

    if (!snapshot.contentHash) {
      errors.push('缺少内容哈希');
    }

    if (typeof snapshot.timestamp !== 'number' || snapshot.timestamp <= 0) {
      errors.push('时间戳无效');
    }

    // 验证哈希
    const expectedHash = this.computeHash(snapshot.title, snapshot.content);
    if (expectedHash !== snapshot.contentHash) {
      errors.push('内容哈希不匹配（可能已被篡改）');
    }

    // 验证内容长度
    const expectedLength = new TextEncoder().encode(
      `${snapshot.title}\n---\n${snapshot.content}`
    ).length;
    if (snapshot.contentLength !== expectedLength) {
      warnings.push('内容长度不匹配');
    }

    // 检查版本链完整性
    if (snapshot.parentVersionId !== undefined) {
      if (snapshot.parentVersionId >= snapshot.versionId) {
        errors.push('父版本 ID 必须小于当前版本 ID');
      }
      if (!snapshot.parentContentHash) {
        warnings.push('有父版本 ID 但缺少父内容哈希');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 验证版本链的完整性
   *
   * @param snapshots 快照列表（按版本顺序）
   * @returns 验证结果
   */
  validateChain(snapshots: VersionedSnapshot[]): SnapshotValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (snapshots.length === 0) {
      return { isValid: true, errors, warnings };
    }

    // 按版本排序
    const sorted = [...snapshots].sort((a, b) => a.versionId - b.versionId);

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];

      // 验证单个快照
      const validation = this.validate(current);
      errors.push(...validation.errors.map((e) => `版本 ${current.versionId}: ${e}`));
      warnings.push(...validation.warnings.map((w) => `版本 ${current.versionId}: ${w}`));

      // 验证链接
      if (i > 0) {
        const previous = sorted[i - 1];

        if (current.parentVersionId !== undefined) {
          if (current.parentVersionId !== previous.versionId) {
            warnings.push(`版本 ${current.versionId}: 父版本 ID 不连续`);
          }

          if (
            current.parentContentHash !== undefined &&
            current.parentContentHash !== previous.contentHash
          ) {
            errors.push(`版本 ${current.versionId}: 父内容哈希不匹配`);
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ================================
  // 工具方法
  // ================================

  /**
   * 计算内容哈希
   *
   * @param title 标题
   * @param content 内容
   * @returns 哈希字符串
   */
  computeHash(title: string, content: string): string {
    const combinedContent = `${title}\n---\n${content}`;
    return this.hasher.hash(combinedContent).hash;
  }

  /**
   * 获取快照的元数据
   *
   * @param snapshot 完整快照
   * @returns 元数据
   */
  getMetadata(snapshot: VersionedSnapshot): SnapshotMetadata {
    return {
      documentId: snapshot.documentId,
      versionId: snapshot.versionId,
      contentHash: snapshot.contentHash,
      timestamp: snapshot.timestamp,
      contentLength: snapshot.contentLength,
      titleSummary: snapshot.title.substring(0, 100),
    };
  }

  /**
   * 创建空的版本向量
   *
   * @param clientId 初始客户端 ID
   * @returns 版本向量
   */
  createVersionVector(clientId: string): VersionVector {
    return {
      entries: [{ clientId, version: 0 }],
      clock: 0,
    };
  }

  /**
   * 更新版本向量
   *
   * @param vector 当前版本向量
   * @param clientId 客户端 ID
   * @param version 新版本号
   * @returns 更新后的版本向量
   */
  updateVersionVector(vector: VersionVector, clientId: string, version: number): VersionVector {
    const entries = vector.entries.filter((e) => e.clientId !== clientId);
    entries.push({ clientId, version });

    return {
      entries,
      clock: vector.clock + 1,
    };
  }

  /**
   * 合并两个版本向量
   *
   * @param a 版本向量 A
   * @param b 版本向量 B
   * @returns 合并后的版本向量
   */
  mergeVersionVectors(a: VersionVector, b: VersionVector): VersionVector {
    const merged = new Map<string, number>();

    for (const entry of a.entries) {
      merged.set(entry.clientId, entry.version);
    }

    for (const entry of b.entries) {
      const existing = merged.get(entry.clientId);
      if (existing === undefined || entry.version > existing) {
        merged.set(entry.clientId, entry.version);
      }
    }

    return {
      entries: Array.from(merged.entries()).map(([clientId, version]) => ({ clientId, version })),
      clock: Math.max(a.clock, b.clock) + 1,
    };
  }

  /**
   * 比较两个版本向量的因果关系
   *
   * @param a 版本向量 A
   * @param b 版本向量 B
   * @returns 'before' | 'after' | 'concurrent' | 'equal'
   */
  compareVersionVectors(
    a: VersionVector,
    b: VersionVector
  ): 'before' | 'after' | 'concurrent' | 'equal' {
    const aMap = new Map(a.entries.map((e) => [e.clientId, e.version]));
    const bMap = new Map(b.entries.map((e) => [e.clientId, e.version]));

    let aHasNewer = false;
    let bHasNewer = false;

    const allClients = new Set([...aMap.keys(), ...bMap.keys()]);

    for (const clientId of allClients) {
      const aVersion = aMap.get(clientId) ?? 0;
      const bVersion = bMap.get(clientId) ?? 0;

      if (aVersion > bVersion) {
        aHasNewer = true;
      } else if (bVersion > aVersion) {
        bHasNewer = true;
      }
    }

    if (aHasNewer && bHasNewer) {
      return 'concurrent';
    } else if (aHasNewer) {
      return 'after';
    } else if (bHasNewer) {
      return 'before';
    } else {
      return 'equal';
    }
  }

  /**
   * 序列化快照为 JSON
   *
   * @param snapshot 快照
   * @returns JSON 字符串
   */
  serialize(snapshot: VersionedSnapshot): string {
    return JSON.stringify(snapshot);
  }

  /**
   * 反序列化快照
   *
   * @param json JSON 字符串
   * @returns 快照
   */
  deserialize(json: string): VersionedSnapshot {
    const data = JSON.parse(json);
    return this.fromData(data);
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 VersionedSnapshotFactory 实例
 */
export function createSnapshotFactory(
  config?: Partial<SnapshotFactoryConfig>
): VersionedSnapshotFactory {
  return new VersionedSnapshotFactory(config);
}

// ================================
// 便捷函数
// ================================

// 默认工厂实例（延迟初始化）
let defaultFactory: VersionedSnapshotFactory | null = null;

/**
 * 获取默认工厂实例
 */
function getDefaultFactory(): VersionedSnapshotFactory {
  if (!defaultFactory) {
    defaultFactory = createSnapshotFactory();
  }
  return defaultFactory;
}

/**
 * 创建版本化快照
 */
export function createSnapshot(params: {
  documentId: string;
  versionId: number;
  title: string;
  content: string;
  parentVersionId?: number;
  parentContentHash?: string;
}): VersionedSnapshot {
  return getDefaultFactory().create(params);
}

/**
 * 比较两个快照
 */
export function compareSnapshots(
  a: VersionedSnapshot,
  b: VersionedSnapshot
): SnapshotCompareResult {
  return getDefaultFactory().compare(a, b);
}

/**
 * 验证快照
 */
export function validateSnapshot(snapshot: VersionedSnapshot): SnapshotValidationResult {
  return getDefaultFactory().validate(snapshot);
}

/**
 * 检查内容是否变化
 */
export function hasSnapshotContentChanged(a: VersionedSnapshot, b: VersionedSnapshot): boolean {
  return getDefaultFactory().hasContentChanged(a, b);
}

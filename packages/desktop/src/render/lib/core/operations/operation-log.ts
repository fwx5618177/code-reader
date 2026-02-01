// ================================
// OperationLog
// 操作日志实现 - 支持增量操作记录和重放
// 为未来协同办公和离线同步做准备
// ================================

import {
  DocumentOperation,
  OperationLogEntry,
  IOperationLog,
  OperationLogConfig,
  OperationLogStats,
  TextOperation,
} from './types';

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<OperationLogConfig> = {
  maxOperations: 1000,
  autoCompact: true,
  debug: false,
};

/**
 * 生成唯一操作 ID
 */
function generateOperationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

/**
 * OperationLog - 操作日志实现
 *
 * 核心特性：
 * 1. **操作记录**：记录所有文档操作，支持重放
 * 2. **版本追踪**：每个操作关联版本号
 * 3. **确认机制**：支持标记操作为已同步
 * 4. **自动压缩**：限制日志大小，自动清理旧操作
 *
 * 使用示例：
 * ```typescript
 * const log = new OperationLog({ maxOperations: 100 });
 *
 * // 添加操作
 * const entry = log.append({
 *   type: 'insert',
 *   id: 'op-1',
 *   timestamp: Date.now(),
 *   clientId: 'client-123',
 *   clock: 1,
 *   position: 0,
 *   content: 'Hello',
 * });
 *
 * // 获取未确认操作
 * const pending = log.getUnacknowledged();
 *
 * // 确认操作
 * log.acknowledge(['op-1']);
 * ```
 */
export class OperationLog implements IOperationLog {
  private readonly config: Required<OperationLogConfig>;
  private entries: OperationLogEntry[];
  private currentVersionId: number;
  private logicalClock: number;
  private readonly clientId: string;

  constructor(config: Partial<OperationLogConfig> = {}, clientId?: string) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.entries = [];
    this.currentVersionId = 0;
    this.logicalClock = 0;
    this.clientId = clientId ?? this.generateClientId();
  }

  // ================================
  // IOperationLog 实现
  // ================================

  /**
   * 添加操作到日志
   *
   * @param operation 要添加的操作
   * @returns 操作日志条目
   */
  append(operation: DocumentOperation): OperationLogEntry {
    const beforeVersionId = this.currentVersionId;
    this.currentVersionId++;
    this.logicalClock++;

    const entry: OperationLogEntry = {
      operation,
      beforeVersionId,
      afterVersionId: this.currentVersionId,
      acknowledged: false,
    };

    this.entries.push(entry);

    this.log(`操作已添加: ${operation.type}, 版本 ${beforeVersionId} -> ${this.currentVersionId}`);

    // 自动压缩
    if (this.config.autoCompact && this.entries.length > this.config.maxOperations) {
      this.compact();
    }

    return entry;
  }

  /**
   * 获取指定版本后的所有操作
   *
   * @param versionId 起始版本 ID
   * @returns 操作日志条目列表
   */
  getSince(versionId: number): OperationLogEntry[] {
    return this.entries.filter((entry) => entry.beforeVersionId >= versionId);
  }

  /**
   * 获取所有未确认的操作
   *
   * @returns 未确认的操作日志条目列表
   */
  getUnacknowledged(): OperationLogEntry[] {
    return this.entries.filter((entry) => !entry.acknowledged);
  }

  /**
   * 标记操作为已确认
   *
   * @param operationIds 操作 ID 列表
   */
  acknowledge(operationIds: string[]): void {
    const idSet = new Set(operationIds);

    for (const entry of this.entries) {
      if (idSet.has(entry.operation.id)) {
        (entry as { acknowledged: boolean }).acknowledged = true;
      }
    }

    this.log(`${operationIds.length} 个操作已确认`);
  }

  /**
   * 获取当前操作数量
   *
   * @returns 操作数量
   */
  getCount(): number {
    return this.entries.length;
  }

  /**
   * 清空日志
   */
  clear(): void {
    this.entries = [];
    this.currentVersionId = 0;
    this.logicalClock = 0;
    this.log('日志已清空');
  }

  /**
   * 压缩日志（移除旧的已确认操作）
   *
   * @param keepCount 保留的操作数量
   */
  compact(keepCount?: number): void {
    const targetCount = keepCount ?? Math.floor(this.config.maxOperations * 0.8);
    const toRemove = this.entries.length - targetCount;

    if (toRemove <= 0) {
      return;
    }

    // 只移除已确认的操作
    let removed = 0;
    const newEntries: OperationLogEntry[] = [];

    for (const entry of this.entries) {
      if (removed < toRemove && entry.acknowledged) {
        removed++;
      } else {
        newEntries.push(entry);
      }
    }

    this.entries = newEntries;
    this.log(`已压缩 ${removed} 个操作`);
  }

  // ================================
  // 扩展 API
  // ================================

  /**
   * 获取当前版本 ID
   */
  getCurrentVersionId(): number {
    return this.currentVersionId;
  }

  /**
   * 获取当前逻辑时钟值
   */
  getLogicalClock(): number {
    return this.logicalClock;
  }

  /**
   * 获取客户端 ID
   */
  getClientId(): string {
    return this.clientId;
  }

  /**
   * 创建插入操作
   *
   * @param position 插入位置
   * @param content 插入内容
   * @returns 操作日志条目
   */
  createInsert(position: number, content: string): OperationLogEntry {
    const operation: TextOperation = {
      type: 'insert',
      id: generateOperationId(),
      timestamp: Date.now(),
      clientId: this.clientId,
      clock: this.logicalClock + 1,
      position,
      content,
    };

    return this.append(operation);
  }

  /**
   * 创建删除操作
   *
   * @param position 删除位置
   * @param length 删除长度
   * @returns 操作日志条目
   */
  createDelete(position: number, length: number): OperationLogEntry {
    const operation: TextOperation = {
      type: 'delete',
      id: generateOperationId(),
      timestamp: Date.now(),
      clientId: this.clientId,
      clock: this.logicalClock + 1,
      position,
      length,
    };

    return this.append(operation);
  }

  /**
   * 创建替换操作
   *
   * @param position 替换位置
   * @param length 替换长度
   * @param content 新内容
   * @returns 操作日志条目
   */
  createReplace(position: number, length: number, content: string): OperationLogEntry {
    const operation: TextOperation = {
      type: 'replace',
      id: generateOperationId(),
      timestamp: Date.now(),
      clientId: this.clientId,
      clock: this.logicalClock + 1,
      position,
      length,
      content,
    };

    return this.append(operation);
  }

  /**
   * 创建设置标题操作
   *
   * @param title 新标题
   * @returns 操作日志条目
   */
  createSetTitle(title: string): OperationLogEntry {
    const operation: DocumentOperation = {
      type: 'set_title',
      id: generateOperationId(),
      timestamp: Date.now(),
      clientId: this.clientId,
      clock: this.logicalClock + 1,
      title,
    };

    return this.append(operation);
  }

  /**
   * 应用操作到文本
   *
   * @param text 原始文本
   * @param operation 操作
   * @returns 应用后的文本
   */
  applyOperation(text: string, operation: TextOperation): string {
    switch (operation.type) {
      case 'insert':
        return (
          text.slice(0, operation.position) + operation.content + text.slice(operation.position)
        );

      case 'delete':
        return (
          text.slice(0, operation.position) + text.slice(operation.position + operation.length)
        );

      case 'replace':
        return (
          text.slice(0, operation.position) +
          operation.content +
          text.slice(operation.position + operation.length)
        );

      case 'retain':
        return text;

      default:
        return text;
    }
  }

  /**
   * 应用多个操作到文本
   *
   * @param text 原始文本
   * @param operations 操作列表
   * @returns 应用后的文本
   */
  applyOperations(text: string, operations: TextOperation[]): string {
    let result = text;
    for (const operation of operations) {
      result = this.applyOperation(result, operation);
    }
    return result;
  }

  /**
   * 重放操作以重建文本
   *
   * @param initialText 初始文本
   * @param fromVersionId 起始版本 ID
   * @param toVersionId 目标版本 ID（可选，默认到最新）
   * @returns 重建后的文本
   */
  replay(initialText: string, fromVersionId: number, toVersionId?: number): string {
    const targetVersion = toVersionId ?? this.currentVersionId;
    let text = initialText;

    for (const entry of this.entries) {
      if (entry.beforeVersionId >= fromVersionId && entry.afterVersionId <= targetVersion) {
        const operation = entry.operation;
        if (this.isTextOperation(operation)) {
          text = this.applyOperation(text, operation);
        }
      }
    }

    return text;
  }

  /**
   * 获取操作统计信息
   *
   * @returns 统计信息
   */
  getStats(): OperationLogStats {
    const operationsByType: Record<string, number> = {};
    let acknowledgedCount = 0;

    for (const entry of this.entries) {
      const type = entry.operation.type;
      operationsByType[type] = (operationsByType[type] ?? 0) + 1;

      if (entry.acknowledged) {
        acknowledgedCount++;
      }
    }

    return {
      totalCount: this.entries.length,
      acknowledgedCount,
      pendingCount: this.entries.length - acknowledgedCount,
      currentVersionId: this.currentVersionId,
      operationsByType,
    };
  }

  /**
   * 获取所有条目（只读）
   *
   * @returns 条目列表
   */
  getEntries(): ReadonlyArray<OperationLogEntry> {
    return this.entries;
  }

  /**
   * 获取指定操作
   *
   * @param operationId 操作 ID
   * @returns 操作日志条目或 undefined
   */
  getEntry(operationId: string): OperationLogEntry | undefined {
    return this.entries.find((entry) => entry.operation.id === operationId);
  }

  /**
   * 从服务器合并远程操作
   *
   * @param remoteEntries 远程操作条目
   * @param serverVersionId 服务器版本 ID
   */
  mergeRemote(remoteEntries: OperationLogEntry[], serverVersionId: number): void {
    // 过滤掉已存在的操作
    const existingIds = new Set(this.entries.map((e) => e.operation.id));
    const newRemoteEntries = remoteEntries.filter((e) => !existingIds.has(e.operation.id));

    // 添加远程操作并标记为已确认
    for (const entry of newRemoteEntries) {
      const newEntry: OperationLogEntry = {
        ...entry,
        acknowledged: true,
      };
      this.entries.push(newEntry);
    }

    // 更新版本号
    if (serverVersionId > this.currentVersionId) {
      this.currentVersionId = serverVersionId;
    }

    // 更新逻辑时钟
    for (const entry of remoteEntries) {
      if (entry.operation.clock > this.logicalClock) {
        this.logicalClock = entry.operation.clock;
      }
    }

    this.log(`合并了 ${newRemoteEntries.length} 个远程操作`);
  }

  /**
   * 序列化日志
   *
   * @returns JSON 字符串
   */
  serialize(): string {
    return JSON.stringify({
      entries: this.entries,
      currentVersionId: this.currentVersionId,
      logicalClock: this.logicalClock,
      clientId: this.clientId,
    });
  }

  /**
   * 从序列化数据恢复日志
   *
   * @param data JSON 字符串
   */
  deserialize(data: string): void {
    try {
      const parsed = JSON.parse(data);
      this.entries = parsed.entries ?? [];
      this.currentVersionId = parsed.currentVersionId ?? 0;
      this.logicalClock = parsed.logicalClock ?? 0;
      // 不覆盖 clientId
      this.log('日志已从序列化数据恢复');
    } catch (error) {
      this.log('反序列化失败:', error);
      throw new Error('无法解析操作日志数据');
    }
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 检查操作是否为文本操作
   */
  private isTextOperation(operation: DocumentOperation): operation is TextOperation {
    return ['insert', 'delete', 'retain', 'replace'].includes(operation.type);
  }

  /**
   * 生成客户端 ID
   */
  private generateClientId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `client-${timestamp}-${random}`;
  }

  /**
   * 输出调试日志
   */
  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[OperationLog]', ...args);
    }
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 OperationLog 实例
 */
export function createOperationLog(
  config?: Partial<OperationLogConfig>,
  clientId?: string
): OperationLog {
  return new OperationLog(config, clientId);
}

// ================================
// 便捷函数
// ================================

// 默认实例（延迟初始化）
let defaultLog: OperationLog | null = null;

/**
 * 获取默认操作日志实例
 */
export function getDefaultOperationLog(): OperationLog {
  if (!defaultLog) {
    defaultLog = createOperationLog();
  }
  return defaultLog;
}

/**
 * 重置默认操作日志实例
 */
export function resetDefaultOperationLog(): void {
  if (defaultLog) {
    defaultLog.clear();
    defaultLog = null;
  }
}

// ================================
// CRDT 接口定义
// 用于实时协作的无冲突复制数据类型
// 仅提供接口，具体实现需接入 Yjs、Automerge 等库
// ================================

/**
 * CRDT (Conflict-free Replicated Data Types)
 *
 * CRDT 是一类特殊的数据结构，能够在分布式系统中
 * 实现无冲突的并发编辑，无需中心化的冲突解决。
 *
 * 常见实现：
 * - Yjs：高性能、广泛使用
 * - Automerge：JSON CRDT
 * - Diamond Types：Rust 实现，极高性能
 *
 * 本模块定义统一接口，未来可接入任意 CRDT 库。
 */

// ================================
// 类型定义
// ================================

/**
 * 客户端/副本标识
 */
export type ClientId = string;

/**
 * 操作时钟（逻辑时间戳）
 */
export interface Clock {
  /** 客户端 ID */
  readonly clientId: ClientId;
  /** 序列号 */
  readonly seq: number;
}

/**
 * 版本向量（用于因果关系追踪）
 */
export type VersionVector = ReadonlyMap<ClientId, number>;

/**
 * 操作类型
 */
export type CRDTOperationType = 'insert' | 'delete' | 'update' | 'move';

/**
 * CRDT 操作
 */
export interface CRDTOperation {
  /** 操作 ID（全局唯一） */
  readonly id: Clock;
  /** 操作类型 */
  readonly type: CRDTOperationType;
  /** 操作位置（对于序列 CRDT） */
  readonly position?: number;
  /** 操作值 */
  readonly value?: unknown;
  /** 删除长度（对于删除操作） */
  readonly length?: number;
  /** 依赖的操作（因果关系） */
  readonly dependencies?: readonly Clock[];
  /** 时间戳 */
  readonly timestamp: number;
}

/**
 * 状态更新
 */
export interface StateUpdate {
  /** 更新数据（编码后） */
  readonly data: Uint8Array;
  /** 来源客户端 */
  readonly origin: ClientId;
  /** 版本向量 */
  readonly version: VersionVector;
}

/**
 * 同步状态
 */
export interface SyncState {
  /** 本地版本向量 */
  readonly localVersion: VersionVector;
  /** 远程版本向量 */
  readonly remoteVersion: VersionVector;
  /** 是否已同步 */
  readonly isSynced: boolean;
  /** 待发送的操作数 */
  readonly pendingOps: number;
}

/**
 * 冲突信息（CRDT 不应该有冲突，但可能有语义冲突）
 */
export interface SemanticConflict {
  /** 冲突类型 */
  readonly type: 'concurrent-edit' | 'delete-update' | 'move-move';
  /** 涉及的操作 */
  readonly operations: readonly CRDTOperation[];
  /** 冲突位置 */
  readonly position?: number;
  /** 解决方案 */
  readonly resolution?: 'last-writer-wins' | 'first-writer-wins' | 'merge';
}

// ================================
// 观察者/监听器接口
// ================================

/**
 * 文档变更事件
 */
export interface DocumentChangeEvent {
  /** 变更来源 */
  readonly origin: 'local' | 'remote';
  /** 操作列表 */
  readonly operations: readonly CRDTOperation[];
  /** 文档新内容 */
  readonly content: string;
  /** 版本向量 */
  readonly version: VersionVector;
}

/**
 * 同步事件
 */
export interface SyncEvent {
  /** 事件类型 */
  readonly type: 'sync-start' | 'sync-complete' | 'sync-error';
  /** 同步状态 */
  readonly state: SyncState;
  /** 错误信息（如果有） */
  readonly error?: string;
}

/**
 * 感知（Awareness）事件
 * 用于光标位置、用户状态等
 */
export interface AwarenessEvent {
  /** 变更的客户端 */
  readonly clientId: ClientId;
  /** 状态类型 */
  readonly type: 'add' | 'update' | 'remove';
  /** 客户端状态 */
  readonly state?: AwarenessState;
}

/**
 * 感知状态
 */
export interface AwarenessState {
  /** 用户信息 */
  readonly user?: {
    readonly name: string;
    readonly color: string;
    readonly avatar?: string;
  };
  /** 光标位置 */
  readonly cursor?: {
    readonly position: number;
    readonly selection?: {
      readonly anchor: number;
      readonly head: number;
    };
  };
  /** 是否在线 */
  readonly online: boolean;
  /** 最后活动时间 */
  readonly lastActive: number;
}

/**
 * 文档变更监听器
 */
export type DocumentChangeListener = (event: DocumentChangeEvent) => void;

/**
 * 同步监听器
 */
export type SyncListener = (event: SyncEvent) => void;

/**
 * 感知监听器
 */
export type AwarenessListener = (event: AwarenessEvent) => void;

// ================================
// CRDT 文档接口
// ================================

/**
 * CRDT 文档接口
 *
 * 定义 CRDT 文档的核心操作。
 * 实现此接口即可接入任意 CRDT 库。
 */
export interface ICRDTDocument {
  /** 文档 ID */
  readonly id: string;

  /** 客户端 ID */
  readonly clientId: ClientId;

  // ================================
  // 内容操作
  // ================================

  /**
   * 获取当前内容
   */
  getContent(): string;

  /**
   * 插入文本
   */
  insert(position: number, text: string): void;

  /**
   * 删除文本
   */
  delete(position: number, length: number): void;

  /**
   * 替换文本
   */
  replace(position: number, length: number, text: string): void;

  /**
   * 设置完整内容（初始化）
   */
  setContent(content: string): void;

  // ================================
  // 同步操作
  // ================================

  /**
   * 获取状态更新（用于同步）
   */
  getStateUpdate(): StateUpdate;

  /**
   * 应用状态更新
   */
  applyStateUpdate(update: StateUpdate): void;

  /**
   * 获取增量更新（自指定版本）
   */
  getDeltaUpdate(since: VersionVector): StateUpdate | null;

  /**
   * 获取完整状态快照
   */
  getSnapshot(): Uint8Array;

  /**
   * 从快照恢复
   */
  loadSnapshot(snapshot: Uint8Array): void;

  // ================================
  // 版本控制
  // ================================

  /**
   * 获取当前版本向量
   */
  getVersion(): VersionVector;

  /**
   * 检查版本是否在本地历史中
   */
  hasVersion(version: VersionVector): boolean;

  /**
   * 获取操作历史
   */
  getHistory(): readonly CRDTOperation[];

  // ================================
  // 事件监听
  // ================================

  /**
   * 监听文档变更
   */
  onDocumentChange(listener: DocumentChangeListener): () => void;

  /**
   * 监听同步事件
   */
  onSync(listener: SyncListener): () => void;

  // ================================
  // 生命周期
  // ================================

  /**
   * 销毁文档
   */
  destroy(): void;
}

// ================================
// 感知接口
// ================================

/**
 * 感知协议接口
 * 用于共享用户状态（光标、选区、在线状态等）
 */
export interface IAwareness {
  /** 本地客户端 ID */
  readonly clientId: ClientId;

  /**
   * 设置本地状态
   */
  setLocalState(state: Partial<AwarenessState>): void;

  /**
   * 获取本地状态
   */
  getLocalState(): AwarenessState | null;

  /**
   * 获取所有客户端状态
   */
  getAllStates(): ReadonlyMap<ClientId, AwarenessState>;

  /**
   * 获取指定客户端状态
   */
  getState(clientId: ClientId): AwarenessState | null;

  /**
   * 监听感知变更
   */
  onAwarenessChange(listener: AwarenessListener): () => void;

  /**
   * 编码感知状态（用于同步）
   */
  encodeState(): Uint8Array;

  /**
   * 应用感知状态更新
   */
  applyStateUpdate(update: Uint8Array): void;

  /**
   * 销毁
   */
  destroy(): void;
}

// ================================
// 同步提供者接口
// ================================

/**
 * 同步提供者配置
 */
export interface SyncProviderConfig {
  /** 服务器 URL */
  serverUrl?: string;
  /** 房间/频道名称 */
  roomName: string;
  /** 认证令牌 */
  authToken?: string;
  /** 自动重连 */
  autoReconnect?: boolean;
  /** 重连间隔（毫秒） */
  reconnectInterval?: number;
  /** 最大重连次数 */
  maxReconnectAttempts?: number;
}

/**
 * 连接状态
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * 同步提供者接口
 * 处理网络同步
 */
export interface ISyncProvider {
  /** 当前连接状态 */
  readonly connectionState: ConnectionState;

  /**
   * 连接到服务器
   */
  connect(): Promise<void>;

  /**
   * 断开连接
   */
  disconnect(): void;

  /**
   * 发送更新
   */
  sendUpdate(update: StateUpdate): void;

  /**
   * 发送感知更新
   */
  sendAwarenessUpdate(update: Uint8Array): void;

  /**
   * 监听连接状态变化
   */
  onConnectionStateChange(listener: (state: ConnectionState) => void): () => void;

  /**
   * 监听收到的更新
   */
  onUpdate(listener: (update: StateUpdate) => void): () => void;

  /**
   * 监听收到的感知更新
   */
  onAwarenessUpdate(listener: (update: Uint8Array) => void): () => void;

  /**
   * 销毁
   */
  destroy(): void;
}

// ================================
// CRDT 引擎接口
// ================================

/**
 * CRDT 引擎配置
 */
export interface CRDTEngineConfig {
  /** 客户端 ID（可选，自动生成） */
  clientId?: ClientId;
  /** 是否启用历史记录 */
  enableHistory?: boolean;
  /** 历史记录最大长度 */
  maxHistoryLength?: number;
  /** GC 间隔（毫秒） */
  gcInterval?: number;
}

/**
 * CRDT 引擎接口
 * 统一管理 CRDT 文档和同步
 */
export interface ICRDTEngine {
  /**
   * 创建新文档
   */
  createDocument(id: string, content?: string): ICRDTDocument;

  /**
   * 获取文档
   */
  getDocument(id: string): ICRDTDocument | null;

  /**
   * 销毁文档
   */
  destroyDocument(id: string): void;

  /**
   * 创建感知实例
   */
  createAwareness(document: ICRDTDocument): IAwareness;

  /**
   * 创建同步提供者
   */
  createSyncProvider(
    document: ICRDTDocument,
    awareness: IAwareness,
    config: SyncProviderConfig
  ): ISyncProvider;

  /**
   * 销毁引擎
   */
  destroy(): void;
}

// ================================
// 适配器类型
// ================================

/**
 * Yjs 适配器（预留）
 */
export interface IYjsAdapter extends ICRDTEngine {
  readonly type: 'yjs';
  /** 获取原生 Y.Doc */
  getNativeDoc(id: string): unknown;
}

/**
 * Automerge 适配器（预留）
 */
export interface IAutomergeAdapter extends ICRDTEngine {
  readonly type: 'automerge';
  /** 获取原生文档 */
  getNativeDoc(id: string): unknown;
}

// ================================
// 工厂函数类型
// ================================

/**
 * CRDT 引擎工厂
 */
export type CRDTEngineFactory = (config?: CRDTEngineConfig) => ICRDTEngine;

/**
 * 注册 CRDT 引擎工厂（用于延迟加载）
 */
export type RegisterCRDTEngine = (name: string, factory: CRDTEngineFactory) => void;

// ================================
// 占位实现状态
// ================================

/**
 * CRDT 功能可用性
 *
 * 当前状态：仅接口定义
 * 未来计划：
 * 1. 集成 Yjs（推荐，最成熟）
 * 2. 集成 Automerge（JSON 友好）
 * 3. 自研轻量级实现（特定场景优化）
 */
export const CRDTFeatureStatus = {
  /** 接口已定义 */
  interfaceDefined: true,
  /** 是否有可用实现 */
  hasImplementation: false,
  /** 推荐的实现 */
  recommendedImplementation: 'yjs',
  /** 未来计划 */
  futurePlans: [
    'Integrate Yjs for text collaboration',
    'Integrate Automerge for structured data',
    'WebSocket sync provider',
    'WebRTC P2P sync provider',
    'IndexedDB persistence provider',
  ],
} as const;

// ================================
// 辅助函数
// ================================

/**
 * 生成客户端 ID
 */
export function generateClientId(): ClientId {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * 比较版本向量
 */
export function compareVersionVectors(
  a: VersionVector,
  b: VersionVector
): 'equal' | 'before' | 'after' | 'concurrent' {
  let aBeforeB = false;
  let bBeforeA = false;

  // 检查 a 中的所有条目
  for (const [clientId, seqA] of a) {
    const seqB = b.get(clientId) ?? 0;
    if (seqA < seqB) aBeforeB = true;
    if (seqA > seqB) bBeforeA = true;
  }

  // 检查 b 中 a 没有的条目
  for (const [clientId, seqB] of b) {
    if (!a.has(clientId)) {
      if (seqB > 0) aBeforeB = true;
    }
  }

  if (!aBeforeB && !bBeforeA) return 'equal';
  if (aBeforeB && !bBeforeA) return 'before';
  if (!aBeforeB && bBeforeA) return 'after';
  return 'concurrent';
}

/**
 * 合并版本向量
 */
export function mergeVersionVectors(a: VersionVector, b: VersionVector): VersionVector {
  const merged = new Map<ClientId, number>();

  for (const [clientId, seq] of a) {
    merged.set(clientId, seq);
  }

  for (const [clientId, seq] of b) {
    const existing = merged.get(clientId) ?? 0;
    merged.set(clientId, Math.max(existing, seq));
  }

  return merged;
}

/**
 * 创建空版本向量
 */
export function createEmptyVersionVector(): VersionVector {
  return new Map();
}

// ================================
// 知识库注册表（纯逻辑，不依赖 Electron / SQLite，便于单测）
// 每个知识库 = 一个独立 SQLite 文件 + 独立附件/备份目录；
// 注册表只保存元数据，路径由 id 推导，避免 userData 迁移后绝对路径失效
// ================================

import { join, relative, isAbsolute } from 'path';

/** 默认知识库：沿用升级前的数据位置（userData 根目录），不搬动用户已有数据 */
export const DEFAULT_WORKSPACE_ID = 'default';
export const DEFAULT_WORKSPACE_NAME = '默认知识库';

/** 新建知识库的根目录所在的父目录（相对 userData） */
export const WORKSPACES_DIR = 'workspaces';

export const WORKSPACE_NAME_MAX_LENGTH = 40;

/** 知识库颜色：取值对应渲染进程主题中的颜色变量，不保存具体色值，随主题变化 */
export const WORKSPACE_COLORS = ['accent', 'info', 'success', 'warning', 'error', 'secondary'] as const;
export type WorkspaceColor = (typeof WORKSPACE_COLORS)[number];

const REGISTRY_VERSION = 1;
/** 新建知识库的 id 由 randomUUID 生成；校验后才会拼进路径，杜绝路径穿越 */
const WORKSPACE_ID_PATTERN = /^[a-z0-9-]+$/;

export interface WorkspaceEntry {
  id: string;
  name: string;
  color: WorkspaceColor;
  createdAt: string;
  /** 从未打开过时为 null */
  lastOpenedAt: string | null;
}

export interface WorkspaceRegistry {
  version: number;
  /** 当前（即下次启动时打开的）知识库 */
  currentId: string;
  workspaces: WorkspaceEntry[];
}

export interface WorkspacePaths {
  /** 知识库根目录；默认知识库为 userData 本身 */
  rootPath: string;
  dbPath: string;
  attachmentsPath: string;
  backupsPath: string;
}

/** 新建或编辑知识库时可修改的字段 */
export interface WorkspaceInput {
  name: string;
  color: WorkspaceColor;
}

// ================================
// 路径
// ================================

/**
 * 计算知识库的数据路径：所有知识库目录结构一致（<root>/data/knowledge.db、<root>/attachments、<root>/backups），
 * 默认知识库的 root 是 userData，与升级前的数据库、附件、备份位置完全相同
 */
export function resolveWorkspacePaths(userDataPath: string, id: string): WorkspacePaths {
  const rootPath =
    id === DEFAULT_WORKSPACE_ID ? userDataPath : join(userDataPath, WORKSPACES_DIR, assertWorkspaceId(id));
  return {
    rootPath,
    dbPath: join(rootPath, 'data', 'knowledge.db'),
    attachmentsPath: join(rootPath, 'attachments'),
    backupsPath: join(rootPath, 'backups'),
  };
}

/**
 * 删除知识库前取得可整体删除的根目录：必须位于 userData/workspaces 之下，
 * 保证无论传入什么 id 都不会删到 userData 本身或其他目录
 */
export function resolveDeletableRoot(userDataPath: string, id: string): string {
  if (id === DEFAULT_WORKSPACE_ID) throw new Error('默认知识库不能删除');
  const parent = join(userDataPath, WORKSPACES_DIR);
  const { rootPath } = resolveWorkspacePaths(userDataPath, id);
  const rel = relative(parent, rootPath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`知识库目录不在 ${parent} 之下，拒绝删除`);
  }
  return rootPath;
}

function assertWorkspaceId(id: string): string {
  if (!WORKSPACE_ID_PATTERN.test(id)) throw new Error(`无效的知识库 ID：${id}`);
  return id;
}

// ================================
// 注册表读取与校验
// ================================

export function createDefaultRegistry(now: string): WorkspaceRegistry {
  return {
    version: REGISTRY_VERSION,
    currentId: DEFAULT_WORKSPACE_ID,
    workspaces: [createDefaultEntry(now)],
  };
}

function createDefaultEntry(now: string): WorkspaceEntry {
  return {
    id: DEFAULT_WORKSPACE_ID,
    name: DEFAULT_WORKSPACE_NAME,
    color: 'accent',
    createdAt: now,
    lastOpenedAt: null,
  };
}

export function isWorkspaceColor(value: unknown): value is WorkspaceColor {
  return typeof value === 'string' && (WORKSPACE_COLORS as readonly string[]).includes(value);
}

function parseEntry(value: unknown, now: string): WorkspaceEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !WORKSPACE_ID_PATTERN.test(raw.id)) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  return {
    id: raw.id,
    name: name || (raw.id === DEFAULT_WORKSPACE_ID ? DEFAULT_WORKSPACE_NAME : raw.id),
    color: isWorkspaceColor(raw.color) ? raw.color : 'accent',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    lastOpenedAt: typeof raw.lastOpenedAt === 'string' ? raw.lastOpenedAt : null,
  };
}

/**
 * 解析注册表文件内容：丢弃无效/重复条目，保证默认知识库存在且排在首位，
 * currentId 指向不存在的知识库时回到默认知识库
 */
export function parseRegistry(raw: unknown, now: string): WorkspaceRegistry {
  if (!raw || typeof raw !== 'object') return createDefaultRegistry(now);
  const data = raw as Record<string, unknown>;
  const list = Array.isArray(data.workspaces) ? data.workspaces : [];

  const seen = new Set<string>();
  const entries: WorkspaceEntry[] = [];
  for (const item of list) {
    const entry = parseEntry(item, now);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }

  const defaultEntry =
    entries.find((entry) => entry.id === DEFAULT_WORKSPACE_ID) ?? createDefaultEntry(now);
  const workspaces = [defaultEntry, ...entries.filter((entry) => entry.id !== DEFAULT_WORKSPACE_ID)];
  const currentId =
    typeof data.currentId === 'string' && seen.has(data.currentId)
      ? data.currentId
      : DEFAULT_WORKSPACE_ID;

  return { version: REGISTRY_VERSION, currentId, workspaces };
}

// ================================
// 注册表变更（均返回新对象，不修改入参）
// ================================

export function findWorkspace(registry: WorkspaceRegistry, id: string): WorkspaceEntry {
  const entry = registry.workspaces.find((workspace) => workspace.id === id);
  if (!entry) throw new Error(`知识库不存在：${id}`);
  return entry;
}

/** 校验名称：去除首尾空白、非空、限制长度、不与其他知识库重名（忽略大小写） */
export function normalizeWorkspaceName(
  registry: WorkspaceRegistry,
  name: unknown,
  excludeId?: string
): string {
  const normalized = typeof name === 'string' ? name.trim() : '';
  if (!normalized) throw new Error('知识库名称不能为空');
  if (normalized.length > WORKSPACE_NAME_MAX_LENGTH) {
    throw new Error(`知识库名称不能超过 ${WORKSPACE_NAME_MAX_LENGTH} 个字符`);
  }
  const lower = normalized.toLowerCase();
  const duplicate = registry.workspaces.some(
    (workspace) => workspace.id !== excludeId && workspace.name.toLowerCase() === lower
  );
  if (duplicate) throw new Error(`已存在名为「${normalized}」的知识库`);
  return normalized;
}

/** 校验可编辑字段（来自 IPC，不能信任类型） */
function normalizeInput(
  registry: WorkspaceRegistry,
  input: WorkspaceInput,
  excludeId?: string
): WorkspaceInput {
  const name = normalizeWorkspaceName(registry, input?.name, excludeId);
  if (!isWorkspaceColor(input.color)) throw new Error(`无效的知识库颜色：${String(input.color)}`);
  return { name, color: input.color };
}

export function addWorkspace(
  registry: WorkspaceRegistry,
  input: WorkspaceInput,
  id: string,
  now: string
): { registry: WorkspaceRegistry; entry: WorkspaceEntry } {
  assertWorkspaceId(id);
  if (id === DEFAULT_WORKSPACE_ID || registry.workspaces.some((workspace) => workspace.id === id)) {
    throw new Error(`知识库 ID 已存在：${id}`);
  }
  const entry: WorkspaceEntry = {
    id,
    ...normalizeInput(registry, input),
    createdAt: now,
    lastOpenedAt: null,
  };
  return { registry: { ...registry, workspaces: [...registry.workspaces, entry] }, entry };
}

/** 修改名称与颜色 */
export function updateWorkspace(
  registry: WorkspaceRegistry,
  id: string,
  input: WorkspaceInput
): WorkspaceRegistry {
  findWorkspace(registry, id);
  const normalized = normalizeInput(registry, input, id);
  return {
    ...registry,
    workspaces: registry.workspaces.map((workspace) =>
      workspace.id === id ? { ...workspace, ...normalized } : workspace
    ),
  };
}

/** 移除知识库：默认知识库与当前打开的知识库不能移除 */
export function removeWorkspace(registry: WorkspaceRegistry, id: string): WorkspaceRegistry {
  findWorkspace(registry, id);
  if (id === DEFAULT_WORKSPACE_ID) throw new Error('默认知识库不能删除');
  if (id === registry.currentId) throw new Error('不能删除当前打开的知识库，请先切换到其他知识库');
  return { ...registry, workspaces: registry.workspaces.filter((workspace) => workspace.id !== id) };
}

/** 记为当前知识库并更新最后打开时间 */
export function markWorkspaceOpened(
  registry: WorkspaceRegistry,
  id: string,
  now: string
): WorkspaceRegistry {
  findWorkspace(registry, id);
  return {
    ...registry,
    currentId: id,
    workspaces: registry.workspaces.map((workspace) =>
      workspace.id === id ? { ...workspace, lastOpenedAt: now } : workspace
    ),
  };
}

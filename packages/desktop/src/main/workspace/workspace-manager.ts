// ================================
// 知识库管理（主进程）
// 注册表保存在 <userData>/config/workspaces.json（与 AI 配置同目录、同样的 JSON 存储方式）；
// 负责打开当前知识库的数据库、切换、增删改，以及向其他模块提供当前知识库的数据路径
// ================================

import { app } from 'electron';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { join } from 'path';
import { getSQLiteService } from '../database/sqlite';
import { getSemanticSearchService } from '../database/semantic-search';
import { getAgentExecutor } from '../agent/agent-executor';
import {
  DEFAULT_WORKSPACE_ID,
  addWorkspace,
  createDefaultRegistry,
  findWorkspace,
  markWorkspaceOpened,
  parseRegistry,
  removeWorkspace,
  resolveDeletableRoot,
  resolveWorkspacePaths,
  updateWorkspace,
  type WorkspaceEntry,
  type WorkspaceInput,
  type WorkspacePaths,
  type WorkspaceRegistry,
} from './registry';

/** 提供给渲染进程的知识库视图：元数据 + 数据路径 + 状态 */
export interface WorkspaceInfo extends WorkspaceEntry, WorkspacePaths {
  isDefault: boolean;
  isCurrent: boolean;
}

const nowIso = () => new Date().toISOString();

class WorkspaceManager {
  private readonly registryPath: string;
  private registry: WorkspaceRegistry;
  /** 切换过程中（停止 Agent → 换库）拒绝新的切换与删除 */
  private switching = false;

  constructor(private readonly userDataPath: string) {
    const configDir = join(userDataPath, 'config');
    mkdirSync(configDir, { recursive: true });
    this.registryPath = join(configDir, 'workspaces.json');
    this.registry = this.load();
  }

  // ================================
  // 查询
  // ================================

  list(): WorkspaceInfo[] {
    return this.registry.workspaces.map((entry) => this.toInfo(entry));
  }

  get(id: string): WorkspaceInfo {
    return this.toInfo(findWorkspace(this.registry, id));
  }

  getCurrent(): WorkspaceInfo {
    return this.get(this.registry.currentId);
  }

  // ================================
  // 增删改
  // ================================

  create(input: WorkspaceInput): WorkspaceInfo {
    const { registry, entry } = addWorkspace(this.registry, input, randomUUID(), nowIso());
    this.save(registry);
    return this.toInfo(entry);
  }

  update(id: string, input: WorkspaceInput): WorkspaceInfo {
    this.save(updateWorkspace(this.registry, id, input));
    return this.get(id);
  }

  /**
   * 删除知识库及其全部文件（数据库、附件、备份）。先校验再询问确认，确认后先删文件再改注册表：
   * 删除文件失败时注册表保持不变，用户可以重试
   * @returns 用户取消时为 false
   */
  async remove(id: string, confirm: (workspace: WorkspaceInfo) => Promise<boolean>): Promise<boolean> {
    this.assertRemovable(id);
    const rootPath = resolveDeletableRoot(this.userDataPath, id);
    if (!(await confirm(this.get(id)))) return false;

    // 确认期间可能已开始切换或已切换到该知识库，重新校验
    this.assertRemovable(id);
    await rm(rootPath, { recursive: true, force: true });
    this.save(removeWorkspace(this.registry, id));
    console.log(`[Workspace] 已删除知识库 ${id}：${rootPath}`);
    return true;
  }

  private assertRemovable(id: string): void {
    if (this.switching) throw new Error('正在切换知识库，请稍候再试');
    removeWorkspace(this.registry, id);
  }

  // ================================
  // 打开与切换
  // ================================

  /**
   * 启动时打开上次使用的知识库；打开失败（如文件损坏）时回到默认知识库，保证应用可用
   */
  openCurrent(): void {
    const id = this.registry.currentId;
    try {
      this.openDatabase(id);
    } catch (error) {
      if (id === DEFAULT_WORKSPACE_ID) throw error;
      console.error(`[Workspace] 打开知识库 ${id} 失败，改为打开默认知识库:`, error);
      this.openDatabase(DEFAULT_WORKSPACE_ID);
    }
  }

  /**
   * 切换知识库：等待渲染进程写回防抖中的数据（仍写入当前库）→ 停止 Agent 并等待执行中的任务结束
   * （避免旧库任务的结果写进新库）→ 关闭当前数据库 → 打开目标数据库（同一条建表 + 迁移路径）→ 恢复 Agent。
   * 打开失败时回到原知识库并抛出错误。渲染进程窗口的重新加载由调用方负责
   * @param flushRenderers 通知渲染进程落盘并等待完成，不应 reject
   * @returns 目标已是当前知识库时为 false
   */
  async switchTo(id: string, flushRenderers: () => Promise<void>): Promise<boolean> {
    findWorkspace(this.registry, id);
    if (id === this.registry.currentId) return false;
    if (this.switching) throw new Error('正在切换知识库，请稍候');

    this.switching = true;
    const previousId = this.registry.currentId;
    const agent = getAgentExecutor();
    const agentWasActive = agent.isActive();
    try {
      await flushRenderers();
      await agent.stop();
      try {
        this.openDatabase(id);
      } catch (error) {
        console.error(`[Workspace] 切换到知识库 ${id} 失败，恢复原知识库:`, error);
        this.openDatabase(previousId);
        throw error;
      }
    } finally {
      if (agentWasActive) agent.start();
      this.switching = false;
    }
    console.log(`[Workspace] 已切换到知识库 ${id}`);
    return true;
  }

  private openDatabase(id: string): void {
    const { dbPath } = resolveWorkspacePaths(this.userDataPath, id);
    getSQLiteService().open(dbPath);
    // 向量缓存以条目 ID 为键，换库后必须清空
    getSemanticSearchService().clearCache();
    this.save(markWorkspaceOpened(this.registry, id, nowIso()));
  }

  // ================================
  // 持久化
  // ================================

  private load(): WorkspaceRegistry {
    if (!existsSync(this.registryPath)) return createDefaultRegistry(nowIso());
    try {
      return parseRegistry(JSON.parse(readFileSync(this.registryPath, 'utf-8')), nowIso());
    } catch (error) {
      // 保留损坏的文件以便手动恢复，其余知识库的数据目录不受影响
      const corruptPath = `${this.registryPath}.corrupt-${Date.now()}`;
      console.error(`[Workspace] 注册表损坏，已另存为 ${corruptPath}，回到默认知识库:`, error);
      renameSync(this.registryPath, corruptPath);
      return createDefaultRegistry(nowIso());
    }
  }

  /** 先写文件再更新内存，写入失败时内存状态不变 */
  private save(next: WorkspaceRegistry): void {
    writeFileSync(this.registryPath, JSON.stringify(next, null, 2), 'utf-8');
    this.registry = next;
  }

  private toInfo(entry: WorkspaceEntry): WorkspaceInfo {
    return {
      ...entry,
      ...resolveWorkspacePaths(this.userDataPath, entry.id),
      isDefault: entry.id === DEFAULT_WORKSPACE_ID,
      isCurrent: entry.id === this.registry.currentId,
    };
  }
}

// ================================
// Singleton Export
// ================================

let workspaceManager: WorkspaceManager | null = null;

export function getWorkspaceManager(): WorkspaceManager {
  if (!workspaceManager) {
    workspaceManager = new WorkspaceManager(app.getPath('userData'));
  }
  return workspaceManager;
}

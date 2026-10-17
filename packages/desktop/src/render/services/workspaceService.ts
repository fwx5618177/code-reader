// ================================
// 知识库客户端
// 主进程（main/workspace）是知识库注册表与数据路径的唯一数据源；本服务只经 window.electron.workspace 读写，
// 缓存最近一次的列表快照供 useSyncExternalStore 订阅。切换成功后主进程会重新加载所有窗口
// ================================

import type { WorkspaceColor, WorkspaceInfo, WorkspaceInput } from '../types/electron';

export type { WorkspaceColor, WorkspaceInfo, WorkspaceInput };

const EMPTY_LIST: WorkspaceInfo[] = [];

class WorkspaceService {
  private snapshot: WorkspaceInfo[] = EMPTY_LIST;
  private listeners = new Set<() => void>();

  /** 从主进程重新读取知识库列表并通知订阅者 */
  async refresh(): Promise<WorkspaceInfo[]> {
    this.snapshot = await window.electron.workspace.list();
    this.listeners.forEach((listener) => listener());
    return this.snapshot;
  }

  /** 最近一次读取的列表；引用在刷新前保持稳定 */
  getSnapshot = (): WorkspaceInfo[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** 当前知识库（附件目录等数据路径以此为准） */
  getCurrent(): Promise<WorkspaceInfo> {
    return window.electron.workspace.getCurrent();
  }

  create(input: WorkspaceInput): Promise<WorkspaceInfo> {
    return this.mutate(() => window.electron.workspace.create(input));
  }

  /** 修改名称与颜色 */
  update(id: string, input: WorkspaceInput): Promise<WorkspaceInfo> {
    return this.mutate(() => window.electron.workspace.update(id, input));
  }

  /**
   * 删除知识库及其全部文件；主进程会弹出确认框
   * @returns 用户取消时为 false
   */
  async remove(id: string): Promise<boolean> {
    const { deleted } = await this.mutate(() => window.electron.workspace.remove(id));
    return deleted;
  }

  /** 切换知识库；成功后窗口会被主进程重新加载 */
  switchTo(id: string): Promise<void> {
    return window.electron.workspace.switchTo(id);
  }

  /** 执行写操作后刷新快照，保证订阅者看到主进程的最新状态 */
  private async mutate<T>(action: () => Promise<T>): Promise<T> {
    const result = await action();
    await this.refresh();
    return result;
  }
}

export const workspaceService = new WorkspaceService();

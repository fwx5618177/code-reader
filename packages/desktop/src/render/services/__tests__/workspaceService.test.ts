import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkspaceInfo } from '../../types/electron';

function info(id: string, isCurrent = false): WorkspaceInfo {
  return {
    id,
    name: id,
    color: 'accent',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastOpenedAt: null,
    isDefault: id === 'default',
    isCurrent,
    rootPath: `/data/${id}`,
    dbPath: `/data/${id}/data/knowledge.db`,
    attachmentsPath: `/data/${id}/attachments`,
    backupsPath: `/data/${id}/backups`,
  };
}

const api = {
  list: vi.fn(),
  getCurrent: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  switchTo: vi.fn(),
};

async function loadService() {
  vi.resetModules();
  return (await import('../workspaceService')).workspaceService;
}

describe('workspaceService', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    vi.stubGlobal('window', { electron: { workspace: api } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refresh 更新快照并通知订阅者', async () => {
    const service = await loadService();
    const list = [info('default', true), info('a')];
    api.list.mockResolvedValue(list);
    const listener = vi.fn();
    service.subscribe(listener);

    expect(service.getSnapshot()).toEqual([]);
    await service.refresh();

    expect(service.getSnapshot()).toBe(list);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('取消订阅后不再通知', async () => {
    const service = await loadService();
    api.list.mockResolvedValue([]);
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);
    unsubscribe();
    await service.refresh();
    expect(listener).not.toHaveBeenCalled();
  });

  it('create / update 成功后刷新列表', async () => {
    const service = await loadService();
    const created = info('b');
    api.create.mockResolvedValue(created);
    api.update.mockResolvedValue(created);
    api.list.mockResolvedValue([info('default', true), created]);

    await expect(service.create({ name: 'b', color: 'info' })).resolves.toBe(created);
    await service.update('b', { name: 'c', color: 'error' });

    expect(api.create).toHaveBeenCalledWith({ name: 'b', color: 'info' });
    expect(api.update).toHaveBeenCalledWith('b', { name: 'c', color: 'error' });
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot()).toHaveLength(2);
  });

  it('remove 返回是否真正删除（用户可能在确认框中取消）', async () => {
    const service = await loadService();
    api.list.mockResolvedValue([]);
    api.remove.mockResolvedValueOnce({ deleted: false }).mockResolvedValueOnce({ deleted: true });

    await expect(service.remove('a')).resolves.toBe(false);
    await expect(service.remove('a')).resolves.toBe(true);
  });

  it('主进程报错时不刷新快照并向上抛出', async () => {
    const service = await loadService();
    api.update.mockRejectedValue(new Error('已存在名为「a」的知识库'));

    await expect(service.update('b', { name: 'a', color: 'info' })).rejects.toThrow('已存在');
    expect(api.list).not.toHaveBeenCalled();
  });

  it('switchTo 与 getCurrent 直接转给主进程', async () => {
    const service = await loadService();
    const current = info('a', true);
    api.getCurrent.mockResolvedValue(current);
    api.switchTo.mockResolvedValue(undefined);

    await expect(service.getCurrent()).resolves.toBe(current);
    await service.switchTo('a');
    expect(api.switchTo).toHaveBeenCalledWith('a');
  });
});

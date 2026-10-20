// ================================
// 渲染进程数据库客户端：查询自动等待初始化，并发共用同一次初始化，失败后可重试
// ================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn<[string, ...unknown[]], Promise<unknown>>();

async function loadService() {
  vi.resetModules();
  vi.stubGlobal('electron', { ipcRenderer: { invoke } });
  return (await import('../database')).default;
}

beforeEach(() => {
  invoke.mockReset();
});

describe('databaseService', () => {
  it('未显式初始化时查询先完成初始化再执行', async () => {
    invoke.mockImplementation(async (channel) => (channel === 'db:all' ? [{ id: 1 }] : undefined));
    const db = await loadService();

    await expect(db.all('SELECT 1')).resolves.toEqual([{ id: 1 }]);
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(['db:initialize', 'db:all']);
  });

  it('并发查询共用同一次初始化', async () => {
    invoke.mockResolvedValue(undefined);
    const db = await loadService();

    await Promise.all([db.get('SELECT 1'), db.run('UPDATE t SET a = 1'), db.initialize()]);
    expect(invoke.mock.calls.filter(([channel]) => channel === 'db:initialize')).toHaveLength(1);
  });

  it('初始化失败后下一次调用会重试', async () => {
    invoke.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const db = await loadService();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(db.all('SELECT 1')).rejects.toThrow('boom');
    await expect(db.all('SELECT 1')).resolves.toEqual([]);
    expect(invoke.mock.calls.filter(([channel]) => channel === 'db:initialize')).toHaveLength(2);
  });
});

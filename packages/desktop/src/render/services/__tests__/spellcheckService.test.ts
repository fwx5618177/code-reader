// ================================
// 拼写检查服务测试：个人词典列表随初始化加载，添加 / 删除即时更新快照并同步到 Worker，
// 删除后清空检查缓存，删除前发出的检查结果作废
// IPC 与 Worker 以假实现替代
// ================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpellWorkerRequest, SpellWorkerResponse } from '../../lib/spellcheck/protocol';

vi.mock('../settingsService', () => ({
  DEFAULT_SPELLCHECK_DICTIONARY: 'builtin:en_US',
  settingsService: {
    get: async () => ({ spellCheck: true, spellCheckDictionary: 'builtin:en_US' }),
    update: async () => undefined,
  },
}));

/** 按协议应答的假 Worker；check 的应答可暂缓，用于模拟检查进行中 */
class FakeWorker {
  static instance: FakeWorker | null = null;
  onmessage: ((event: MessageEvent<SpellWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: SpellWorkerRequest[] = [];
  holdChecks = false;
  private held: SpellWorkerRequest[] = [];

  constructor() {
    FakeWorker.instance = this;
  }

  postMessage(request: SpellWorkerRequest): void {
    this.requests.push(request);
    if (request.method === 'check' && this.holdChecks) {
      this.held.push(request);
      return;
    }
    queueMicrotask(() => this.respond(request));
  }

  releaseChecks(): void {
    for (const request of this.held.splice(0)) this.respond(request);
  }

  terminate(): void {}

  private respond(request: SpellWorkerRequest): void {
    const result = request.method === 'check' ? [] : undefined;
    this.onmessage?.({ data: { id: request.id, ok: true, result } } as MessageEvent<SpellWorkerResponse>);
  }
}

const ipc = {
  listDictionaries: vi.fn(async () => [{ id: 'builtin:en_US', name: 'en_US', source: 'builtin' }]),
  readDictionary: vi.fn(async () => ({ aff: new Uint8Array(), dic: new Uint8Array() })),
  importDictionary: vi.fn(),
  removeDictionary: vi.fn(),
  getUserWords: vi.fn(async () => ['zed', 'alpha']),
  addUserWord: vi.fn(async () => undefined),
  removeUserWord: vi.fn(async () => undefined),
};

async function loadService() {
  vi.resetModules();
  const { spellcheckService } = await import('../spellcheckService');
  await spellcheckService.init();
  return spellcheckService;
}

beforeEach(() => {
  FakeWorker.instance = null;
  vi.stubGlobal('Worker', FakeWorker);
  (window as unknown as { electron: unknown }).electron = { spellcheck: ipc };
});

describe('spellcheckService 个人词典', () => {
  it('初始化时读取个人词典，并在加载词典时交给 Worker', async () => {
    const service = await loadService();
    expect(service.getSnapshot().userWords).toEqual(['zed', 'alpha']);
    const load = FakeWorker.instance!.requests.find((request) => request.method === 'load');
    expect(load?.params).toMatchObject({ userWords: ['zed', 'alpha'] });
    expect(service.getSnapshot().status).toBe('ready');
  });

  it('添加单词后快照立即包含该词', async () => {
    const service = await loadService();
    await service.addToDictionary('beta');
    expect(ipc.addUserWord).toHaveBeenCalledWith('beta');
    expect(service.getSnapshot().userWords).toEqual(['zed', 'alpha', 'beta']);
  });

  it('删除单词：持久化、更新快照、同步 Worker、清空缓存并通知编辑器', async () => {
    const service = await loadService();
    await service.checkWords(['zed', 'other']);
    expect(service.lookup('zed')).toBe(true);

    const listener = vi.fn();
    service.subscribe(listener);
    await service.removeFromDictionary('zed');

    expect(ipc.removeUserWord).toHaveBeenCalledWith('zed');
    expect(service.getSnapshot().userWords).toEqual(['alpha']);
    const removal = FakeWorker.instance!.requests.find((request) => request.method === 'removeWords');
    expect(removal?.params).toEqual({ words: ['zed'] });
    expect(service.lookup('zed')).toBeUndefined();
    expect(service.lookup('other')).toBeUndefined();
    expect(listener).toHaveBeenCalled();
  });

  it('删除前发出、删除后才返回的检查结果作废', async () => {
    const service = await loadService();
    const worker = FakeWorker.instance!;
    worker.holdChecks = true;

    const checking = service.checkWords(['zed']);
    await service.removeFromDictionary('zed');
    worker.releaseChecks();
    await checking;

    expect(service.lookup('zed')).toBeUndefined();
  });
});

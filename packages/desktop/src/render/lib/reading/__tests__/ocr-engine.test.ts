// ================================
// 文字识别引擎测试：按 tesseract Worker 消息协议驱动；初始化任一步失败、Worker 脚本加载失败、
// 识别失败或主动终止时 Worker 都会被终止，挂起的任务随之失败
// ================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOcrSession } from '../ocr-engine';

interface Packet {
  workerId: string;
  jobId: string;
  action: string;
  payload: unknown;
}

/** 按动作给出应答的假 Worker；返回 undefined 表示不应答（挂起） */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static reply: (packet: Packet) => { status: 'resolve' | 'reject'; data: unknown } | undefined = () => ({
    status: 'resolve',
    data: {},
  });

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly received: Packet[] = [];
  terminated = false;

  constructor(readonly url: string) {
    FakeWorker.instances.push(this);
  }

  postMessage(packet: Packet) {
    this.received.push(packet);
    const answer = FakeWorker.reply(packet);
    if (!answer) return;
    queueMicrotask(() => {
      this.onmessage?.({ data: { workerId: packet.workerId, jobId: packet.jobId, action: packet.action, ...answer } } as MessageEvent);
    });
  }

  terminate() {
    this.terminated = true;
  }
}

function canvas(): HTMLCanvasElement {
  // jsdom 的 Blob 没有 arrayBuffer，只提供用到的部分
  const blob = { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Blob;
  return {
    toBlob: (callback: BlobCallback) => callback(blob),
  } as unknown as HTMLCanvasElement;
}

beforeEach(() => {
  FakeWorker.instances = [];
  FakeWorker.reply = () => ({ status: 'resolve', data: {} });
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createOcrSession', () => {
  it('依次加载引擎、语言、初始化并设置自动版面分析，识别返回 blocks', async () => {
    const blocks = [{ paragraphs: [] }];
    FakeWorker.reply = (packet) => ({ status: 'resolve', data: packet.action === 'recognize' ? { blocks } : {} });

    const session = await createOcrSession(['chi_sim', 'eng']);
    const worker = FakeWorker.instances[0];
    expect(worker.url).toBe('ocr-resource://engine/worker.min.js');
    expect(worker.received.map((packet) => packet.action)).toEqual(['load', 'loadLanguage', 'initialize', 'setParameters']);
    expect(worker.received[1].payload).toMatchObject({
      langs: ['chi_sim', 'eng'],
      options: { langPath: 'ocr-resource://languages', cacheMethod: 'none' },
    });
    expect(worker.received[3].payload).toEqual({ params: { tessedit_pageseg_mode: '3' } });

    await expect(session.recognize(canvas())).resolves.toBe(blocks);
    const recognize = worker.received[4];
    expect(recognize.action).toBe('recognize');
    expect((recognize.payload as { image: Uint8Array }).image).toEqual(new Uint8Array([1, 2, 3]));

    await session.terminate();
    expect(worker.terminated).toBe(true);
  });

  it('语言数据加载失败时终止 Worker 并抛出错误', async () => {
    FakeWorker.reply = (packet) =>
      packet.action === 'loadLanguage' ? { status: 'reject', data: 'Error: 语言文件损坏' } : { status: 'resolve', data: {} };

    await expect(createOcrSession(['eng'])).rejects.toThrow('语言文件损坏');
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it('Worker 脚本加载失败时终止 Worker，挂起的初始化随之失败', async () => {
    FakeWorker.reply = () => undefined;
    const creating = createOcrSession(['eng']);
    const worker = FakeWorker.instances[0];
    worker.onerror?.({ message: '无法加载脚本', preventDefault: () => {} } as ErrorEvent);

    await expect(creating).rejects.toThrow('无法加载脚本');
    expect(worker.terminated).toBe(true);
  });

  it('识别失败时终止 Worker，之后的识别立即失败', async () => {
    FakeWorker.reply = (packet) =>
      packet.action === 'recognize' ? { status: 'reject', data: 'RuntimeError: 内存不足' } : { status: 'resolve', data: {} };
    const session = await createOcrSession(['eng']);

    await expect(session.recognize(canvas())).rejects.toThrow('内存不足');
    expect(FakeWorker.instances[0].terminated).toBe(true);
    await expect(session.recognize(canvas())).rejects.toThrow('内存不足');
  });

  it('终止会话时进行中的识别失败', async () => {
    FakeWorker.reply = (packet) => (packet.action === 'recognize' ? undefined : { status: 'resolve', data: {} });
    const session = await createOcrSession(['eng']);
    const recognizing = session.recognize(canvas());
    await new Promise((resolve) => setTimeout(resolve, 0));

    await session.terminate();
    await expect(recognizing).rejects.toThrow('文字识别已终止');
  });
});

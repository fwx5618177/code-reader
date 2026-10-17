// ================================
// 文字识别引擎（tesseract.js 的 Worker 端）
// Worker 脚本、WASM 核心与语言数据全部经主进程的 ocr-resource:// 协议从本地资源目录加载，不访问 CDN；
// 不使用 IndexedDB 缓存语言数据（cacheMethod: 'none'），删除或替换语言文件后立即生效。
//
// 不使用 tesseract.js 的 createWorker：它把 Worker 句柄藏在闭包里，Worker 脚本加载失败或语言数据
// 加载失败时句柄不会交出（后者 Promise 甚至永不 settle），初始化失败的 Worker 无法终止。
// 这里直接创建 tesseract.js 自带的 Worker 脚本并按其消息协议
// （请求 { workerId, jobId, action, payload }，应答 { jobId, action, status, data }）驱动，
// Worker 句柄始终由本模块持有：初始化的任何一步失败、识别失败或取消都会终止 Worker。
// ================================

import type { RecognizedBlock } from './ocr';

const RESOURCE_ROOT = 'ocr-resource://';

/** tesseract OEM.LSTM_ONLY：只使用 LSTM 引擎（与打包的 *-lstm 核心一致） */
const OEM_LSTM_ONLY = 1;
/** tesseract PSM.AUTO：整页扫描件自动分析版面（默认的单一文本块模式会把多栏合成一栏） */
const PSM_AUTO = '3';

export interface OcrSession {
  /** 识别画布内容，返回 tesseract 的 blocks */
  recognize(canvas: HTMLCanvasElement): Promise<RecognizedBlock[]>;
  /** 终止 Worker（进行中的识别随之中止） */
  terminate(): Promise<void>;
}

/** Worker 应答 */
interface WorkerReply {
  jobId: string;
  action: string;
  status: 'resolve' | 'reject' | 'progress';
  data: unknown;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  if (error && typeof error === 'object' && 'message' in error) return new Error(String(error.message));
  return new Error(String(error));
}

/** 画布编码为 PNG 字节（Worker 端按图片文件解码） */
function canvasBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('无法编码页面图像'));
        return;
      }
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, 'image/png');
  });
}

let workerCounter = 0;

/**
 * 持有 Worker 句柄的最小客户端：按 jobId 匹配应答；Worker 出错或终止后所有进行中与后续的任务都会失败
 */
class TesseractWorkerClient {
  private readonly worker: Worker;
  private readonly workerId = `Worker-${++workerCounter}`;
  private jobCounter = 0;
  private readonly pending = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void }>();
  private failure: Error | null = null;

  constructor(workerPath: string) {
    // ocr-resource:// 与页面不同源，不能直接作为 Worker 入口；与 tesseract.js 的做法一致，
    // 用同源的 Blob 脚本 importScripts 引擎脚本（CSP 放行了 worker-src blob: 与 script-src ocr-resource:）
    const bootstrap = URL.createObjectURL(
      new Blob([`importScripts(${JSON.stringify(workerPath)});`], { type: 'application/javascript' })
    );
    try {
      this.worker = new Worker(bootstrap);
    } finally {
      URL.revokeObjectURL(bootstrap);
    }
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.fail(new Error(event.message || '文字识别引擎加载失败'));
    };
    this.worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      if (data.status === 'progress') return;
      const job = this.pending.get(data.jobId);
      if (!job) return;
      this.pending.delete(data.jobId);
      if (data.status === 'resolve') job.resolve(data.data);
      else job.reject(toError(data.data));
    };
  }

  send(action: string, payload: unknown): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const jobId = `Job-${++this.jobCounter}`;
    return new Promise((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject });
      this.worker.postMessage({ workerId: this.workerId, jobId, action, payload });
    });
  }

  /** 终止 Worker，未完成的任务以 reason 失败 */
  fail(reason: Error): void {
    if (!this.failure) {
      this.failure = reason;
      this.worker.terminate();
    }
    for (const job of this.pending.values()) job.reject(this.failure);
    this.pending.clear();
  }
}

/**
 * 创建识别会话：加载引擎与所选语言（第一项为主语言）；任何一步失败都会终止 Worker 后抛出
 */
export async function createOcrSession(languages: readonly string[]): Promise<OcrSession> {
  const client = new TesseractWorkerClient(`${RESOURCE_ROOT}engine/worker.min.js`);
  const langs = [...languages];
  try {
    // 目录形式的 corePath：由 Worker 按是否支持 SIMD 选择 tesseract-core-simd-lstm / tesseract-core-lstm
    await client.send('load', { options: { lstmOnly: true, corePath: `${RESOURCE_ROOT}engine/`, logging: false } });
    await client.send('loadLanguage', {
      langs,
      options: {
        langPath: `${RESOURCE_ROOT}languages`,
        // 请求 <语言>.traineddata；主进程可返回 gzip 压缩的文件，Worker 按魔数自动解压
        gzip: false,
        cacheMethod: 'none',
        lstmOnly: true,
      },
    });
    await client.send('initialize', { langs, oem: OEM_LSTM_ONLY, config: {} });
    await client.send('setParameters', { params: { tessedit_pageseg_mode: PSM_AUTO } });
  } catch (error) {
    const reason = toError(error);
    client.fail(reason);
    throw reason;
  }

  return {
    async recognize(canvas) {
      const image = await canvasBytes(canvas);
      try {
        const data = (await client.send('recognize', {
          image,
          options: {},
          output: { text: false, blocks: true, hocr: false, tsv: false },
        })) as { blocks?: RecognizedBlock[] | null };
        return data.blocks ?? [];
      } catch (error) {
        const reason = toError(error);
        client.fail(reason);
        throw reason;
      }
    },
    terminate: async () => {
      client.fail(new Error('文字识别已终止'));
    },
  };
}

// ================================
// 文字识别引擎（tesseract.js）
// Worker 脚本、WASM 核心与语言数据全部经主进程的 ocr-resource:// 协议从本地资源目录加载，不访问 CDN；
// 不使用 IndexedDB 缓存语言数据（cacheMethod: 'none'），删除或替换语言文件后立即生效。
//
// tesseract.js 5.1.1 createWorker 的失败行为（见 node_modules/tesseract.js/src/createWorker.js）：
// - Worker 脚本加载失败（onerror）或引擎 load 失败：返回的 Promise reject；
// - 语言数据加载或 initialize 失败：内部 .catch(() => {}) 吞掉错误，Promise 永不 settle，只调用 errorHandler
//   （参数仅为错误信息），因此以 errorHandler 触发的失败与之竞速。
// 两种情况下 Worker 句柄只存在于 createWorker 的闭包中（仅成功时随返回对象交出），Worker 端失败后也不会
// 自行 close，库又不导出 spawnWorker 等底层接口，所以初始化失败的 Worker 无法终止，会保留到渲染进程重载。
// 唯一的绕法是临时替换全局 Worker 构造函数截获实例，属于对全局对象的侵入式修改，不采用。
// 可用语言已按实际存在的语言数据筛选，实际只在语言文件损坏等少见情况下发生。
// 创建成功后的任何失败都会终止 Worker；取消识别只能终止 Worker。
// ================================

import type { RecognizedBlock } from './ocr';

const RESOURCE_ROOT = 'ocr-resource://';

export interface OcrSession {
  /** 识别画布内容，返回 tesseract 的 blocks */
  recognize(canvas: HTMLCanvasElement): Promise<RecognizedBlock[]>;
  /** 终止 Worker（进行中的识别随之中止） */
  terminate(): Promise<void>;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * 创建识别会话：加载引擎与所选语言（第一项为主语言）
 */
export async function createOcrSession(languages: readonly string[]): Promise<OcrSession> {
  const { createWorker, OEM, PSM } = await import('tesseract.js');
  let fail: (error: Error) => void = () => {};
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  // 只在与各步骤竞速时使用；空闲时发生的失败由下一步报告
  failed.catch(() => undefined);
  const worker = await Promise.race([
    createWorker([...languages], OEM.LSTM_ONLY, {
      workerPath: `${RESOURCE_ROOT}engine/worker.min.js`,
      // 目录形式：由 tesseract.js 按是否支持 SIMD 选择 tesseract-core-simd-lstm / tesseract-core-lstm
      corePath: `${RESOURCE_ROOT}engine/`,
      langPath: `${RESOURCE_ROOT}languages`,
      // 请求 <语言>.traineddata；主进程可返回 gzip 压缩的文件，Worker 按魔数自动解压
      gzip: false,
      cacheMethod: 'none',
      errorHandler: (error: unknown) => fail(toError(error)),
    }),
    failed,
  ]);
  try {
    // 整页扫描件：自动分析版面（默认的单一文本块模式会把多栏合成一栏）
    await Promise.race([worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO }), failed]);
  } catch (error) {
    await worker.terminate();
    throw error;
  }

  return {
    async recognize(canvas) {
      const { data } = await Promise.race([
        worker.recognize(canvas, {}, { text: false, blocks: true, hocr: false, tsv: false }),
        failed,
      ]);
      return data.blocks ?? [];
    },
    terminate: async () => {
      await worker.terminate();
    },
  };
}

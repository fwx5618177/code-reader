// ================================
// LaTeX 文档分析客户端：编辑器与侧栏大纲共用
//
// - 在 Worker 中分析（按块缓存：80 万字符文档改动一段约 10ms，整篇重新分析约 120ms）；Worker 不可用时回退为主线程同步分析
// - 缓存最近一次结果，并合并同一内容的并发请求：编辑器诊断与侧栏大纲对同一份内容只解析一次
// ================================

import { LatexAnalyzer, type LatexAnalysis } from './analysis';

export interface AnalysisWorkerRequest {
  id: number;
  source: string;
}

export interface AnalysisWorkerResponse {
  id: number;
  result?: LatexAnalysis;
  error?: string;
}

let worker: Worker | null = null;
let workerFailed = false;
let nextRequestId = 1;
const pending = new Map<number, { resolve: (result: LatexAnalysis) => void; reject: (error: Error) => void }>();

let latest: { source: string; result: LatexAnalysis } | null = null;
let inflight: { source: string; promise: Promise<LatexAnalysis> } | null = null;
/** 主线程回退路径的分析器（同样按块缓存） */
let fallbackAnalyzer: LatexAnalyzer | null = null;

/**
 * 分析 LaTeX 源码；同一内容的重复请求复用缓存或在途请求
 */
export function requestLatexAnalysis(source: string): Promise<LatexAnalysis> {
  if (latest?.source === source) return Promise.resolve(latest.result);
  if (inflight?.source === source) return inflight.promise;

  const promise = analyzeInWorker(source)
    .catch(() => (fallbackAnalyzer ??= new LatexAnalyzer()).analyze(source))
    .then((result) => {
      latest = { source, result };
      return result;
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
  inflight = { source, promise };
  return promise;
}

function analyzeInWorker(source: string): Promise<LatexAnalysis> {
  const target = ensureWorker();
  if (!target) return Promise.reject(new Error('分析 Worker 不可用'));
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    target.postMessage({ id, source } satisfies AnalysisWorkerRequest);
  });
}

function ensureWorker(): Worker | null {
  if (worker) return worker;
  if (workerFailed || typeof Worker === 'undefined') return null;
  try {
    const created = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    created.onmessage = (event: MessageEvent<AnalysisWorkerResponse>) => {
      const { id, result, error } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (result) entry.resolve(result);
      else entry.reject(new Error(error ?? '分析 Worker 返回空结果'));
    };
    created.onerror = (event) => {
      event.preventDefault();
      failWorker(new Error(`分析 Worker 错误: ${event.message || 'unknown'}`));
    };
    worker = created;
    return created;
  } catch (error) {
    console.warn('[LatexAnalysis] 无法创建分析 Worker，回退主线程:', error);
    workerFailed = true;
    return null;
  }
}

/** Worker 出错后不再使用，在途请求转为主线程分析 */
function failWorker(error: Error): void {
  console.warn('[LatexAnalysis]', error.message);
  workerFailed = true;
  worker?.terminate();
  worker = null;
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}

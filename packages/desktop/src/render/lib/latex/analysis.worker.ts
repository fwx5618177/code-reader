// ================================
// LaTeX 文档分析 Worker：整篇解析不阻塞输入
// ================================

import { analyzeLatex } from './analysis';
import type { AnalysisWorkerRequest, AnalysisWorkerResponse } from './analysis-client';

self.onmessage = (event: MessageEvent<AnalysisWorkerRequest>) => {
  const { id, source } = event.data;
  let response: AnalysisWorkerResponse;
  try {
    response = { id, result: analyzeLatex(source) };
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};

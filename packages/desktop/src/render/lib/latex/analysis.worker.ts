// ================================
// LaTeX 文档分析 Worker：不阻塞输入；按块缓存分析结果，编辑时只重新分析改动的块
// ================================

import { LatexAnalyzer } from './analysis';
import type { AnalysisWorkerRequest, AnalysisWorkerResponse } from './analysis-client';

const analyzer = new LatexAnalyzer();

self.onmessage = (event: MessageEvent<AnalysisWorkerRequest>) => {
  const { id, source } = event.data;
  let response: AnalysisWorkerResponse;
  try {
    response = { id, result: analyzer.analyze(source) };
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};

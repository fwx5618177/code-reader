// ================================
// LaTeX 渲染 Worker
// 批量渲染可视区外的块，避免大文档首屏/宏变化时阻塞主线程。
// 每个请求自带渲染所需的全局上下文（宏定义、section 索引），Worker 不持有文档状态。
// ================================

import type { RenderWorkerRequest, RenderWorkerResponse } from './types';
import { LatexRenderer } from './renderer';

let renderer: LatexRenderer | null = null;

self.onmessage = (event: MessageEvent<RenderWorkerRequest>) => {
  const { id, options, preamble, sectionIndex, jobs } = event.data;
  let response: RenderWorkerResponse;

  try {
    renderer ??= new LatexRenderer(options);
    renderer.setPreamble(preamble);
    renderer.setSectionIndex(sectionIndex);
    response = {
      id,
      results: jobs.map((job) => ({
        id: job.id,
        renderKey: job.renderKey,
        html: renderer!.renderLatexBlock(job, preamble),
      })),
    };
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : String(error) };
  }

  self.postMessage(response);
};

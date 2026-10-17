// ================================
// 拼写检查 Worker 通信协议
// ================================

export interface SpellWorkerMethods {
  /** 加载词典（替换当前词典）并加入用户词 */
  load: { params: { aff: Uint8Array; dic: Uint8Array; userWords: string[] }; result: void };
  /** 返回其中拼写错误的单词 */
  check: { params: { words: string[] }; result: string[] };
  suggest: { params: { word: string }; result: string[] };
  /** 向当前词典追加用户词 */
  addWords: { params: { words: string[] }; result: void };
}

export type SpellWorkerMethod = keyof SpellWorkerMethods;

export type SpellWorkerRequest = {
  [K in SpellWorkerMethod]: { id: number; method: K; params: SpellWorkerMethods[K]['params'] };
}[SpellWorkerMethod];

export type SpellWorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

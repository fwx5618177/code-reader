// ================================
// 拼写检查 Web Worker
// 词典解析与查词、生成建议都在后台线程完成，避免阻塞编辑器
// ================================

import { Hunspell } from './hunspell';
import { suggest } from './suggest';
import type { SpellWorkerRequest, SpellWorkerResponse } from './protocol';

let hunspell: Hunspell | null = null;

function requireDictionary(): Hunspell {
  if (!hunspell) throw new Error('词典尚未加载');
  return hunspell;
}

function handle(request: SpellWorkerRequest): unknown {
  switch (request.method) {
    case 'load': {
      const loaded = Hunspell.fromBytes(request.params.aff, request.params.dic);
      for (const word of request.params.userWords) loaded.addWord(word);
      hunspell = loaded;
      return undefined;
    }
    case 'check': {
      const dictionary = requireDictionary();
      return request.params.words.filter((word) => !dictionary.check(word));
    }
    case 'suggest':
      return suggest(requireDictionary(), request.params.word);
    case 'addWords': {
      const dictionary = requireDictionary();
      for (const word of request.params.words) dictionary.addWord(word);
      return undefined;
    }
    case 'removeWords':
      // 尚未加载词典时无需处理：下次加载会使用已更新的用户词表
      for (const word of request.params.words) hunspell?.removeWord(word);
      return undefined;
  }
}

self.onmessage = (event: MessageEvent<SpellWorkerRequest>) => {
  const request = event.data;
  let response: SpellWorkerResponse;
  try {
    response = { id: request.id, ok: true, result: handle(request) };
  } catch (error) {
    response = { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};

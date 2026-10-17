// ================================
// 知识库问答会话：提问、重试，并把最近几轮对话作为上下文传给模型
// 由工作区持有，切换视图后对话保留
// ================================

import { useCallback, useRef, useState } from 'react';
import type { ChatMessage } from '../../types/electron';
import { askKnowledgeBase, type AnswerSource } from '../../lib/agent/askService';

/** 作为上下文的最近轮数 */
const HISTORY_TURNS = 6;

export interface AskTurn {
  id: string;
  question: string;
  /** pending：检索中；streaming：回答生成中（answer 为已收到的部分） */
  status: 'pending' | 'streaming' | 'done' | 'error';
  answer?: string;
  sources?: AnswerSource[];
  error?: string;
}

/** 某轮之前已完成的最近几轮对话 → 模型消息 */
export function buildHistory(turns: AskTurn[], beforeId: string): ChatMessage[] {
  const index = turns.findIndex((turn) => turn.id === beforeId);
  return turns
    .slice(0, index === -1 ? turns.length : index)
    .filter((turn) => turn.status === 'done' && turn.answer)
    .slice(-HISTORY_TURNS)
    .flatMap<ChatMessage>((turn) => [
      { role: 'user', content: turn.question },
      { role: 'assistant', content: turn.answer! },
    ]);
}

export interface AskConversation {
  turns: AskTurn[];
  pending: boolean;
  ask: (question: string) => void;
  retry: (id: string) => void;
}

export function useAskConversation(): AskConversation {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const nextId = useRef(0);

  const patch = useCallback((id: string, update: Partial<AskTurn>) => {
    setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, ...update } : turn)));
  }, []);

  const run = useCallback(
    (id: string, question: string, history: ChatMessage[]) => {
      // 增量按帧合并后再写入状态，避免每个 token 触发一次渲染
      let partial = '';
      let frame = 0;
      const flush = () => {
        frame = 0;
        patch(id, { answer: partial });
      };
      const cancelFlush = () => {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      };

      askKnowledgeBase(question, history, {
        onSources: (sources) => patch(id, { status: 'streaming', sources, answer: '' }),
        onDelta: (delta) => {
          partial += delta;
          if (!frame) frame = requestAnimationFrame(flush);
        },
      })
        .then(({ answer, sources }) => {
          cancelFlush();
          patch(id, { status: 'done', answer, sources });
        })
        .catch((error: unknown) => {
          cancelFlush();
          patch(id, {
            status: 'error',
            answer: undefined,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    },
    [patch]
  );

  const ask = useCallback(
    (question: string) => {
      const id = `turn-${nextId.current++}`;
      const history = buildHistory(turnsRef.current, id);
      setTurns((prev) => [...prev, { id, question, status: 'pending' }]);
      run(id, question, history);
    },
    [run]
  );

  const retry = useCallback(
    (id: string) => {
      const turn = turnsRef.current.find((t) => t.id === id);
      if (!turn) return;
      patch(id, { status: 'pending', error: undefined });
      run(id, turn.question, buildHistory(turnsRef.current, id));
    },
    [patch, run]
  );

  return {
    turns,
    pending: turns.some((turn) => turn.status === 'pending' || turn.status === 'streaming'),
    ask,
    retry,
  };
}

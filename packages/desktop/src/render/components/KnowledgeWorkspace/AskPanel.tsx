// ================================
// 知识库问答：基于知识库内容回答问题，回答中的 [n] 引用可点击定位到来源条目
// 回答按纯文本解析为 React 节点渲染，不使用 innerHTML
// ================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, Bot, RefreshCw, Settings } from 'lucide-react';
import aiConfigService from '../../services/aiConfigService';
import type { AnswerSource } from '../../lib/agent/askService';
import { displayTitle } from '../../lib/links/link-index';
import { ITEM_TYPE_ICONS } from '../ReadingWorkspace/item-type';
import { parseAnswer } from './citations';
import type { AskConversation, AskTurn } from './useAskConversation';
import styles from './AskPanel.module.scss';

type ProviderState = 'checking' | 'ready' | 'missing';

/** 检测是否有可用的 AI 服务商 */
function useProviderState(): [ProviderState, () => void] {
  const [state, setState] = useState<ProviderState>('checking');

  const check = useCallback(() => {
    setState('checking');
    aiConfigService
      .hasUsableProvider()
      .then((usable) => setState(usable ? 'ready' : 'missing'))
      .catch((error: unknown) => {
        console.error('[Ask] 检测 AI 服务商失败:', error);
        setState('missing');
      });
  }, []);

  useEffect(check, [check]);
  return [state, check];
}

const sourceTitle = (source: AnswerSource) => displayTitle(source.title) || '未命名';

const Answer: React.FC<{
  answer: string;
  sources: AnswerSource[];
  /** 生成中：末尾显示光标，来源列表待完成后再显示 */
  streaming: boolean;
  onSelectItem: (id: string) => void;
}> = ({ answer, sources, streaming, onSelectItem }) => (
  <>
    <div className={styles.answer} aria-busy={streaming}>
      {parseAnswer(answer, sources).map((paragraph, p, paragraphs) => (
        <p key={p}>
          {paragraph.map((segment, s) =>
            segment.kind === 'text' ? (
              <React.Fragment key={s}>{segment.text}</React.Fragment>
            ) : (
              <button
                key={s}
                type="button"
                className={styles.cite}
                title={sourceTitle(segment.source)}
                onClick={() => onSelectItem(segment.source.itemId)}
              >
                {segment.source.index}
              </button>
            )
          )}
          {streaming && p === paragraphs.length - 1 && <span className={styles.caret} />}
        </p>
      ))}
    </div>
    {!streaming && sources.length > 0 && (
      <ol className={styles.sources} aria-label="来源">
        {sources.map((source) => {
          const Icon = ITEM_TYPE_ICONS[source.type];
          return (
            <li key={source.index}>
              <button type="button" className={styles.source} onClick={() => onSelectItem(source.itemId)}>
                <span className={styles.sourceIndex}>{source.index}</span>
                <Icon size={12} />
                <span className={styles.sourceTitle}>{sourceTitle(source)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    )}
  </>
);

const Turn: React.FC<{
  turn: AskTurn;
  onRetry: (id: string) => void;
  onSelectItem: (id: string) => void;
}> = ({ turn, onRetry, onSelectItem }) => {
  const streaming = turn.status === 'streaming';
  const hasText = Boolean(turn.answer);
  return (
    <>
      <div className={styles.question}>{turn.question}</div>
      <div className={styles.reply}>
        <Bot size={16} className={styles.avatar} />
        <div className={styles.replyBody}>
          {(turn.status === 'pending' || (streaming && !hasText)) && (
            <span className={styles.typing} aria-label="正在思考">
              <span />
              <span />
              <span />
            </span>
          )}
          {(turn.status === 'done' || (streaming && hasText)) && (
            <Answer
              answer={turn.answer ?? ''}
              sources={turn.sources ?? []}
              streaming={streaming}
              onSelectItem={onSelectItem}
            />
          )}
          {turn.status === 'error' && (
            <div className={styles.error} role="alert">
              <AlertCircle size={13} />
              <span>回答失败：{turn.error}</span>
              <button type="button" className={styles.retry} onClick={() => onRetry(turn.id)}>
                <RefreshCw size={12} />
                重试
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export interface AskPanelProps {
  conversation: AskConversation;
  onSelectItem: (id: string) => void;
  onOpenSettings: () => void;
}

export const AskPanel: React.FC<AskPanelProps> = ({ conversation, onSelectItem, onOpenSettings }) => {
  const { turns, pending, ask, retry } = conversation;
  const [provider, recheck] = useProviderState();
  const [input, setInput] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);

  // 新消息或回答增量到达时滚动到底部
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const submit = () => {
    const question = input.trim();
    if (!question || pending) return;
    ask(question);
    setInput('');
  };

  return (
    <div className={styles.panel}>
      <div ref={messagesRef} className={styles.messages}>
        <div className={styles.thread}>
          {turns.length === 0 ? (
            <div className={styles.intro}>
              <Bot size={28} className={styles.introIcon} />
              <h3>向知识库提问</h3>
              <p>AI 会检索相关条目并据此回答，回答中的编号可以点击查看来源。</p>
            </div>
          ) : (
            turns.map((turn) => (
              <Turn key={turn.id} turn={turn} onRetry={retry} onSelectItem={onSelectItem} />
            ))
          )}
        </div>
      </div>

      <div className={styles.composer}>
        {provider === 'missing' ? (
          <div className={styles.setup}>
            <span>问答需要先配置可用的 AI 服务商。</span>
            <button type="button" className={styles.setupButton} onClick={onOpenSettings}>
              <Settings size={13} />
              打开设置
            </button>
            <button type="button" className={styles.retry} onClick={recheck}>
              <RefreshCw size={12} />
              重新检测
            </button>
          </div>
        ) : (
          <div className={styles.inputBox}>
            <textarea
              className={styles.input}
              value={input}
              rows={2}
              placeholder={provider === 'checking' ? '正在检测 AI 服务…' : '输入问题，Enter 发送，Shift+Enter 换行'}
              aria-label="问题"
              disabled={provider !== 'ready'}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <button
              type="button"
              className={styles.send}
              title="发送"
              aria-label="发送"
              disabled={provider !== 'ready' || pending || !input.trim()}
              onClick={submit}
            >
              <ArrowUp size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

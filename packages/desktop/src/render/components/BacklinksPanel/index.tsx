// ================================
// 反向链接面板（写作模式右侧）
// - 反向链接：哪些笔记通过 [[ ]] 引用了当前文档（带上下文；块引用显示被引用的块）
// - 出链：当前文档引用的笔记，未创建的目标可一键创建
// - 未链接提及：正文提到了当前标题但尚未建立链接的笔记
// - 局部图谱：以当前文档为中心的关系网
// ================================

import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Link2, Plus, Quote, Share2, X } from 'lucide-react';
import KnowledgeGraph from '../KnowledgeGraph';
import { displayTitle, useLinkResolver, type LinkIndex, type RelatedLink } from '../../lib/links';
import type { KnowledgeItem } from '../../types/knowledge';
import styles from './BacklinksPanel.module.scss';

type PanelTab = 'backlinks' | 'outgoing' | 'mentions' | 'graph';

export interface BacklinksPanelProps {
  /** 当前文档 */
  item: KnowledgeItem;
  /** 全部条目（用于查找未链接提及） */
  items: KnowledgeItem[];
  linkIndex: LinkIndex;
  related: RelatedLink[];
  onOpenItem: (id: string) => void;
  onCreateNote: (title: string) => void;
  /** 关闭右侧面板；不传时为嵌入模式（应用侧栏「参考」）：宽度随容器、无关闭按钮 */
  onClose?: () => void;
}

/** 截取提及位置附近的文本 */
function mentionContext(content: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(content.length, index + length + 40);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  return `${prefix}${content.slice(start, end).replace(/\s+/g, ' ')}${suffix}`;
}

const BacklinksPanel: React.FC<BacklinksPanelProps> = ({
  item,
  items,
  linkIndex,
  related,
  onOpenItem,
  onCreateNote,
  onClose,
}) => {
  const [tab, setTab] = useState<PanelTab>('backlinks');
  const title = displayTitle(item.title);

  const backlinks = useMemo(() => linkIndex.backlinks(item.id), [linkIndex, item.id]);

  // 块引用指向的块文本（块 ID → 文本）
  const linkResolver = useLinkResolver();
  const blockTexts = useMemo(() => {
    if (!backlinks.some((link) => link.blockId)) return new Map<string, string>();
    const blocks = linkResolver?.blocks(item.title) ?? [];
    return new Map(blocks.flatMap((block) => (block.id ? [[block.id, block.text] as const] : [])));
  }, [backlinks, linkResolver, item.title]);

  const outgoing = useMemo(() => {
    const seen = new Set<string>();
    return linkIndex.outgoingLinks(item.id).filter((link) => {
      const key = link.target.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [linkIndex, item.id]);

  const mentions = useMemo(() => {
    const needle = title.trim().toLowerCase();
    if (needle.length < 2) return [];
    const linkedSources = new Set(backlinks.map((link) => link.sourceId));
    const result: { id: string; title: string; context: string }[] = [];
    for (const other of items) {
      if (other.id === item.id || other.type !== 'note' || linkedSources.has(other.id)) continue;
      const content = other.content ?? '';
      const index = content.toLowerCase().indexOf(needle);
      if (index === -1) continue;
      result.push({
        id: other.id,
        title: displayTitle(other.title),
        context: mentionContext(content, index, needle.length),
      });
    }
    return result;
  }, [items, item.id, title, backlinks]);

  const tabs: { id: PanelTab; label: string; count?: number; icon: React.ReactNode }[] = [
    { id: 'backlinks', label: '反向链接', count: backlinks.length, icon: <Link2 size={13} /> },
    { id: 'outgoing', label: '出链', count: outgoing.length, icon: <ArrowUpRight size={13} /> },
    { id: 'mentions', label: '未链接提及', count: mentions.length, icon: <Quote size={13} /> },
    { id: 'graph', label: '局部图谱', icon: <Share2 size={13} /> },
  ];

  return (
    <aside className={`${styles.panel} ${onClose ? '' : styles.embedded}`}>
      <header className={styles.header}>
        <div className={styles.tabs} role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
              onClick={() => setTab(t.id)}
              title={t.label}
            >
              {t.icon}
              <span>{t.label}</span>
              {t.count !== undefined && <span className={styles.count}>{t.count}</span>}
            </button>
          ))}
        </div>
        {onClose && (
          <button type="button" className={styles.close} onClick={onClose} title="关闭面板">
            <X size={14} />
          </button>
        )}
      </header>

      <div className={styles.body}>
        {tab === 'backlinks' &&
          (backlinks.length === 0 ? (
            <p className={styles.empty}>
              还没有笔记链接到这里。在其他笔记中输入 [[{title}]] 即可建立链接。
            </p>
          ) : (
            <ul className={styles.list}>
              {backlinks.map((link, index) => (
                <li key={`${link.sourceId}-${index}`}>
                  <button
                    type="button"
                    className={styles.entry}
                    onClick={() => onOpenItem(link.sourceId)}
                  >
                    <span className={styles.entryTitle}>{link.sourceTitle}</span>
                    {link.blockId && (
                      <span className={styles.blockRef}>
                        <span className={styles.blockId}>^{link.blockId}</span>
                        <span className={styles.blockText}>
                          {blockTexts.get(link.blockId) ?? '块不存在'}
                        </span>
                      </span>
                    )}
                    <span className={styles.entryContext}>{link.context}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}

        {tab === 'outgoing' &&
          (outgoing.length === 0 ? (
            <p className={styles.empty}>当前文档没有 [[双向链接]]。输入 [[ 可以搜索并链接其他笔记。</p>
          ) : (
            <ul className={styles.list}>
              {outgoing.map((link) => {
                const target = linkIndex.resolve(link.target);
                return (
                  <li key={link.target}>
                    {target ? (
                      <button
                        type="button"
                        className={styles.entry}
                        onClick={() => onOpenItem(target.id)}
                      >
                        <span className={styles.entryTitle}>{displayTitle(target.title)}</span>
                        {link.alias && (
                          <span className={styles.entryContext}>显示为「{link.alias}」</span>
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`${styles.entry} ${styles.unresolved}`}
                        onClick={() => onCreateNote(link.target)}
                        title="目标文档尚不存在，点击创建"
                      >
                        <span className={styles.entryTitle}>
                          <Plus size={12} /> {link.target}
                        </span>
                        <span className={styles.entryContext}>未创建 · 点击新建</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ))}

        {tab === 'mentions' &&
          (mentions.length === 0 ? (
            <p className={styles.empty}>没有发现提到「{title}」但未链接的笔记。</p>
          ) : (
            <ul className={styles.list}>
              {mentions.map((mention) => (
                <li key={mention.id}>
                  <button
                    type="button"
                    className={styles.entry}
                    onClick={() => onOpenItem(mention.id)}
                  >
                    <span className={styles.entryTitle}>{mention.title}</span>
                    <span className={styles.entryContext}>{mention.context}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}

        {tab === 'graph' && (
          <div className={styles.graph}>
            <KnowledgeGraph
              index={linkIndex}
              related={related}
              focusId={item.id}
              mode="local"
              onOpenItem={onOpenItem}
              onCreateNote={onCreateNote}
              compact
            />
          </div>
        )}
      </div>
    </aside>
  );
};

export default BacklinksPanel;

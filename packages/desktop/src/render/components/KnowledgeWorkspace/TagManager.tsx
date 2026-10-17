// ================================
// 标签管理对话框：列出全部标签及条目数，行内重命名（与已有标签同名时合并）、多选合并、设置颜色
// 未搜索时按层级（“父/子”）缩进显示；重命名填写完整路径，可改变层级，子标签随之改名
// ================================

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AlertCircle, Ban, Merge, Search, X } from 'lucide-react';
import type { Tag } from '../../types/knowledge';
import type { UseKnowledgeBaseReturn } from '../../lib/knowledge/useKnowledgeBase';
import { buildTagTree, flattenTagTree } from '../../lib/knowledge/tag-tree';
import { ancestorTagPaths, isTagPathWithin } from '../../../shared/tag-path';
import { TAG_COLORS, tagColorStyle } from './TagColor';
import styles from './TagManager.module.scss';

export interface TagManagerProps {
  kb: UseKnowledgeBaseReturn;
  onClose: () => void;
}

interface RenameDraft {
  id: string;
  value: string;
}

export const TagManager: React.FC<TagManagerProps> = ({ kb, onClose }) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<RenameDraft | null>(null);
  /** Esc 取消重命名：随后的失焦不保存 */
  const cancelRenameRef = useRef(false);
  const [paletteId, setPaletteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 条目数按当前未删除的条目实时统计
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of kb.items) {
      for (const tagId of item.tagIds) map.set(tagId, (map.get(tagId) ?? 0) + 1);
    }
    return map;
  }, [kb.items]);

  const rows = useMemo((): Array<{ tag: Tag; depth: number; label: string }> => {
    const keyword = query.trim().toLowerCase();
    if (keyword) {
      // 搜索时按条目数排序平铺，显示完整路径
      return kb.tags
        .filter((tag) => tag.name.toLowerCase().includes(keyword))
        .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name))
        .map((tag) => ({ tag, depth: 0, label: tag.name }));
    }
    // 旧数据中可能没有同名的父标签：按实际存在的祖先缩进，名称显示相对最近祖先的路径
    const names = new Set(kb.tags.map((tag) => tag.name));
    return flattenTagTree(buildTagTree(kb.tags)).flatMap(({ node }) => {
      if (!node.tag) return [];
      const ancestors = ancestorTagPaths(node.path).filter((path) => names.has(path));
      const label = ancestors.length > 0 ? node.path.slice(ancestors[0].length + 1) : node.path;
      return [{ tag: node.tag, depth: ancestors.length, label }];
    });
  }, [kb.tags, counts, query]);

  // 已被合并掉的标签自动从选择中剔除
  const selectedTags = kb.tags.filter((tag) => selected.has(tag.id));
  const mergeTarget = selectedTags.find((tag) => tag.id === mergeTargetId) ?? selectedTags[0];
  const renameConflict = renaming
    ? kb.tags.find((tag) => tag.id !== renaming.id && tag.name === renaming.value.trim())
    : undefined;
  /** 重命名会一并改名的子标签数 */
  const renamingTag = renaming ? kb.tags.find((tag) => tag.id === renaming.id) : undefined;
  const descendantCount = renamingTag
    ? kb.tags.filter((tag) => tag.id !== renamingTag.id && isTagPathWithin(tag.name, renamingTag.name)).length
    : 0;

  /** 执行写操作，失败时在对话框内提示 */
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const commitRename = () => {
    if (!renaming) return;
    setRenaming(null);
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      return;
    }
    const name = renaming.value.trim();
    const current = kb.tags.find((tag) => tag.id === renaming.id);
    if (!name || !current || name === current.name) return;
    void run(() => kb.renameTag(renaming.id, name));
  };

  const pickColor = (id: string, color: string | null) => {
    setPaletteId(null);
    void run(() => kb.setTagColor(id, color));
  };

  const merge = () => {
    if (!mergeTarget || selectedTags.length < 2) return;
    const sourceIds = selectedTags.filter((tag) => tag.id !== mergeTarget.id).map((tag) => tag.id);
    void run(async () => {
      await kb.mergeTags(sourceIds, mergeTarget.id);
      setSelected(new Set());
      setMergeTargetId(null);
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    if (paletteId) setPaletteId(null);
    else onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="管理标签"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <header className={styles.header}>
          <h3>
            管理标签 <span className={styles.total}>{kb.tags.length}</span>
          </h3>
          <button type="button" className={styles.iconButton} title="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <label className={styles.search}>
          <Search size={13} />
          <input
            autoFocus
            value={query}
            placeholder="查找标签"
            aria-label="查找标签"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        {error && (
          <p className={styles.error} role="alert">
            <AlertCircle size={13} />
            操作失败：{error}
          </p>
        )}

        {rows.length === 0 ? (
          <p className={styles.empty}>{kb.tags.length === 0 ? '还没有标签' : '没有匹配的标签'}</p>
        ) : (
          <ul className={styles.list}>
            {rows.map(({ tag, depth, label }) => {
              const isSelected = selected.has(tag.id);
              const isRenaming = renaming?.id === tag.id;
              return (
                <li
                  key={tag.id}
                  className={styles.row}
                  data-selected={isSelected}
                  style={{ '--tag-depth': depth } as React.CSSProperties}
                >
                  <div className={styles.rowMain}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={isSelected}
                      aria-label={`选择标签「${tag.name}」`}
                      onChange={() => toggleSelected(tag.id)}
                    />
                    <button
                      type="button"
                      className={styles.swatch}
                      style={tagColorStyle(tag.color)}
                      title="设置颜色"
                      aria-label={`设置「${tag.name}」的颜色`}
                      aria-expanded={paletteId === tag.id}
                      onClick={() => setPaletteId(paletteId === tag.id ? null : tag.id)}
                    />
                    {isRenaming ? (
                      <input
                        autoFocus
                        className={styles.nameInput}
                        value={renaming.value}
                        aria-label={`重命名标签「${tag.name}」`}
                        onChange={(event) => setRenaming({ id: tag.id, value: event.target.value })}
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                          if (event.nativeEvent.isComposing) return;
                          if (event.key === 'Enter') event.currentTarget.blur();
                          if (event.key === 'Escape') {
                            // 只取消编辑，不关闭对话框
                            event.stopPropagation();
                            cancelRenameRef.current = true;
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className={styles.name}
                        title={`${tag.name}（点击重命名）`}
                        disabled={busy}
                        onClick={() => setRenaming({ id: tag.id, value: tag.name })}
                      >
                        {label}
                      </button>
                    )}
                    <span className={styles.count}>{counts.get(tag.id) ?? 0}</span>
                  </div>

                  {isRenaming && renameConflict && (
                    <p className={styles.rowHint}>已存在「{renameConflict.name}」，保存后将合并到该标签</p>
                  )}
                  {isRenaming && descendantCount > 0 && (
                    <p className={styles.rowHint}>其下 {descendantCount} 个子标签会一并改名</p>
                  )}

                  {paletteId === tag.id && (
                    <div className={styles.palette} role="group" aria-label="标签颜色">
                      {TAG_COLORS.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          className={styles.paletteOption}
                          style={tagColorStyle(option.key)}
                          title={option.label}
                          aria-label={option.label}
                          aria-pressed={tag.color === option.key}
                          onClick={() => pickColor(tag.id, option.key)}
                        />
                      ))}
                      <button
                        type="button"
                        className={styles.paletteClear}
                        aria-pressed={!tag.color}
                        onClick={() => pickColor(tag.id, null)}
                      >
                        <Ban size={12} />
                        无颜色
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <footer className={styles.footer}>
          {mergeTarget && selectedTags.length >= 2 ? (
            <>
              <span>将 {selectedTags.length} 个标签合并为</span>
              <select
                className={styles.select}
                aria-label="合并目标"
                value={mergeTarget.id}
                onChange={(event) => setMergeTargetId(event.target.value)}
              >
                {selectedTags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
              <button type="button" className={styles.primaryButton} disabled={busy} onClick={merge}>
                <Merge size={13} />
                合并
              </button>
            </>
          ) : (
            <span className={styles.hint}>
              点击名称重命名（用“父/子”表示层级），点击色块设置颜色；勾选两个或以上标签可合并
            </span>
          )}
        </footer>
      </div>
    </div>
  );
};

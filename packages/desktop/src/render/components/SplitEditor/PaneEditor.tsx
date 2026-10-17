// ================================
// 编辑窗格：分栏中每一栏各自的编辑器与编辑会话
//
// 写入按文档路由：本栏的编辑直接写入该文档的托管实例（DocumentEditorManager，按文档 ID 唯一），
// 与哪一栏聚焦无关。因此切换聚焦栏时编辑器不重建，光标与滚动位置都保留；聚焦栏切换的异步过程中
// 输入的内容也不会写进别的文档。
// 同一文档在两栏打开时共用一个实例：一栏对标题或正文的编辑写入模型后，另一栏把模型内容作为外部更新同步过来
// （非聚焦栏合并一段时间再同步，避免每次按键都整篇重建）；版本恢复、侧栏重命名等也经此同步。
// ================================

import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { documentService, getFileTypeId, keepFileExtension } from '../../lib/documents';
import {
  getEditorManager,
  useManagedEditor,
  type EditorModel,
  type ISaveExecutor,
} from '../../lib/core';
import { registerFlush } from '../../services/flushRegistry';
import type { RichEditorProps } from '../RichEditor';
import styles from './SplitEditor.module.scss';

const RichEditor = lazy(() => import('../RichEditor'));

/** 编辑写入模型前的微防抖：合并同一帧内的多次变更 */
const COMMIT_DELAY_MS = 16;
/** 非聚焦栏同步另一栏编辑的合并间隔 */
const BACKGROUND_SYNC_DELAY_MS = 300;

export type PaneEditorProps = {
  docId: string;
  /** 聚焦的一栏：插件桥接的活动编辑器，外部内容立即同步 */
  focused: boolean;
  /** 保存执行器（与编辑会话共用，保存后同样更新文档列表、索引与版本） */
  executor: ISaveExecutor;
  /** 传给编辑器的其余属性；options 中的 title / onTitleChange 由本组件提供 */
  editorProps: Omit<
    RichEditorProps,
    'initialContent' | 'onChange' | 'fileType' | 'fileName' | 'active' | 'externalUpdate'
  >;
};

/** 加载结果；null 表示文档不存在 */
type LoadedDocument = { title: string; content: string } | null;

export const PaneEditor: React.FC<PaneEditorProps> = ({ docId, focused, executor, editorProps }) => {
  // undefined 表示加载中
  const [loaded, setLoaded] = useState<LoadedDocument | undefined>(undefined);

  /** 本栏编辑器中已与模型一致的标题与正文：加载时的、本栏写入的或已同步过来的 */
  const syncedRef = useRef<LoadedDocument>(null);

  useEffect(() => {
    const show = (document: LoadedDocument) => {
      syncedRef.current = document;
      setLoaded(document);
    };
    // 文档已有托管实例（另一栏或编辑会话正在编辑）时以内存中的内容为准
    const live = getEditorManager().get(docId);
    if (live) {
      show({ title: live.model.getTitle(), content: live.model.getContent() });
      return;
    }
    let cancelled = false;
    documentService
      .getDocument(docId)
      .then((document) => {
        if (!cancelled) show(document ? { title: document.title, content: document.content } : null);
      })
      .catch((error) => {
        console.error('加载文档失败:', error);
        if (!cancelled) show(null);
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  /** 尚未写入模型的本栏编辑 */
  const pendingRef = useRef<string | null>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const [external, setExternal] = useState<{ title?: string; content?: string } | null>(null);

  // 模型的标题或正文变化：不是本栏写入的就同步到本栏编辑器
  const modelRef = useRef<EditorModel | null>(null);

  const applyModelChange = useCallback(() => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    const model = modelRef.current;
    const synced = syncedRef.current;
    if (!model || !synced) return;
    const update: { title?: string; content?: string } = {};
    const title = model.getTitle();
    if (title !== synced.title) update.title = title;
    // 本栏有尚未写入的编辑时正文以本栏为准，写入后其他栏会同步过去
    const content = model.getContent();
    if (pendingRef.current === null && content !== synced.content) update.content = content;
    if (update.title === undefined && update.content === undefined) return;
    syncedRef.current = { title, content: update.content ?? synced.content };
    setExternal(update);
  }, []);

  const handleModelChange = useCallback(() => {
    const model = modelRef.current;
    const synced = syncedRef.current;
    if (!model || !synced) return;
    if (model.getTitle() === synced.title && model.getContent() === synced.content) return;
    if (focusedRef.current) applyModelChange();
    else syncTimerRef.current ??= setTimeout(applyModelChange, BACKGROUND_SYNC_DELAY_MS);
  }, [applyModelChange]);

  const session = useManagedEditor({
    documentId: loaded ? docId : null,
    initialTitle: loaded?.title,
    initialContent: loaded?.content,
    executor,
    onContentChange: handleModelChange,
  });
  modelRef.current = session.model;

  // 取得实例后对齐：加载期间实例可能已被别处创建并修改
  useEffect(() => {
    if (session.isReady) handleModelChange();
  }, [session.isReady, handleModelChange]);

  // 成为聚焦栏时立即应用尚在合并中的同步
  useEffect(() => {
    if (focused && syncTimerRef.current) applyModelChange();
  }, [focused, applyModelChange]);

  const commit = useCallback(() => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const content = pendingRef.current;
    const synced = syncedRef.current;
    if (content === null || !synced) return;
    pendingRef.current = null;
    syncedRef.current = { ...synced, content };
    modelRef.current?.updateContent(content);
  }, []);

  const handleChange = useCallback(
    (content: string) => {
      pendingRef.current = content;
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      commitTimerRef.current = setTimeout(commit, COMMIT_DELAY_MS);
    },
    [commit]
  );

  const handleTitleChange = useCallback((title: string) => {
    const model = modelRef.current;
    const synced = syncedRef.current;
    if (!model || !synced) return;
    const finalTitle = keepFileExtension(model.getTitle(), title);
    // 本栏输入框保留用户输入的原样，补回扩展名后的标题不再同步回来
    syncedRef.current = { ...synced, title: finalTitle };
    model.updateTitle(finalTitle);
  }, []);

  // 落盘（切换知识库、关闭窗口、退出前）：先写入微防抖中的编辑，再写回本文档
  useEffect(
    () =>
      registerFlush(async () => {
        commit();
        const result = await getEditorManager().get(docId)?.saveEngine.flush();
        if (result && !result.success) throw new Error(`文档保存失败 - ${docId}: ${result.error}`);
      }),
    [commit, docId]
  );

  // 卸载（关闭标签、切换本栏文档）时写入最后的编辑；实例释放后由其自身完成自动保存
  useEffect(
    () => () => {
      commit();
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    },
    [commit]
  );

  if (loaded === undefined) {
    return <div className={styles.paneStatus}>加载中...</div>;
  }
  if (loaded === null) {
    return <div className={styles.paneStatus}>文档不存在或已删除</div>;
  }

  const title = session.isReady ? session.title : loaded.title;
  return (
    <Suspense fallback={<div className={styles.paneStatus}>加载编辑器...</div>}>
      <RichEditor
        {...editorProps}
        initialContent={loaded.content}
        onChange={handleChange}
        fileType={getFileTypeId(title)}
        fileName={title}
        active={focused}
        externalUpdate={external}
        options={{ ...editorProps.options, title: loaded.title, onTitleChange: handleTitleChange }}
      />
    </Suspense>
  );
};

export default PaneEditor;

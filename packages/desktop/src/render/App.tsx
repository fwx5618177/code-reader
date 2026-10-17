import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useReducer,
  useRef,
  Suspense,
  lazy,
} from 'react';
import Layout from './components/Layout';
import QuickInput, { QuickInputData } from './components/QuickInput';
import SearchPanel from './components/SearchPanel';
import SettingsPanel from './components/SettingsPanel';
import EditorFooter from './components/EditorFooter';
import WelcomeGuide, { wasWelcomeGuideDismissed } from './components/WelcomeGuide';
import WritingSidebar, { type CreateDocumentOptions } from './components/WritingSidebar';
import VersionHistory from './components/VersionHistory';
import TitleInput from './components/TitleInput';

// Lazy load heavy editor components for better initial load performance
const RichEditor = lazy(() => import('./components/RichEditor'));

// Loading fallback component
const EditorLoadingFallback: React.FC = () => (
  <div className="editor-loading">
    <div className="loading-spinner" />
    <span>加载编辑器...</span>
  </div>
);

import VirtualFolders, { VirtualFolder } from './components/VirtualFolders';
import InputDialog, { ConfirmDialog } from './components/InputDialog';
import KnowledgeWorkspace from './components/KnowledgeWorkspace';
import AgentActivityPanel from './components/AgentActivity';
import BacklinksPanel from './components/BacklinksPanel';
import {
  ReadingShelf,
  ReadingView,
  isOnShelf,
  type CreateExcerptInput,
} from './components/ReadingWorkspace';
import {
  useDocuments,
  PLACEHOLDERS,
  fileTypeRegistry,
  getFileTypeId,
  type DocumentTypeId,
} from './lib/documents';
import { ensureExtension } from './lib/documents/file-types';
import { useKnowledgeBase } from './lib/knowledge/useKnowledgeBase';
import { captureQuickInput, requestProcessing } from './lib/knowledge/service';
import { knowledgeRepository } from './lib/knowledge/repository';
import { SMART_FOLDER_PRESETS } from './lib/knowledge/filter-rules';
import {
  displayTitle,
  linkRepository,
  useLinkIndex,
  useRelatedLinks,
} from './lib/links';
import { extractWikiLinks } from './lib/markdown';
import { ChevronDown, ChevronRight, Plus, PenTool, X, History, Link2 } from 'lucide-react';
import { AppMode, APP_MODE_CONFIGS, appReducer, DEFAULT_APP_STATE } from './types/app-modes';
import { aiConfigService } from './services/aiConfigService';
import './App.scss';

const App: React.FC = () => {
  // Use reducer for app state management
  const [appState, dispatch] = useReducer(appReducer, DEFAULT_APP_STATE);

  // Local UI state
  // 侧边栏折叠状态（当前固定为展开）
  const sidebarCollapsed = false;
  const [explorerExpanded, setExplorerExpanded] = useState(true);

  // 知识库：SQLite 是唯一数据源，知识库、写作、阅读、Agent 共用
  const kb = useKnowledgeBase(true);
  const linkIndex = useLinkIndex(kb.items);
  const relatedLinks = useRelatedLinks(kb.items);

  // 知识库侧边栏选中的范围（智能文件夹或用户文件夹）与选中的条目
  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const [selectedKnowledgeItemId, setSelectedKnowledgeItemId] = useState<string | undefined>();

  // 阅读模式选中的条目
  const [readingItemId, setReadingItemId] = useState<string | undefined>();

  // 写作模式的反向链接面板
  const [showBacklinks, setShowBacklinks] = useState(true);

  // 轻提示（快速收集结果等）
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Writing mode state - using useDocuments hook for document management
  // Auto-save is now handled internally by the hook via AutoSaveManager
  const {
    // List state
    documents: documentList,
    listLoading: documentsLoading,

    // Editor state
    currentDocument,
    selectedId: selectedDocId,
    editorLoading,
    isDirty: editorDirty,

    // Auto-save state
    isSaving,
    lastSavedAt,

    // Global state
    isInitialized: documentsInitialized,
    isFirstTime,

    // Computed values
    wordCount: docWordCount,
    charCount: docCharCount,

    // Actions
    initialize: initializeDocuments,
    selectDocument,
    reloadDocument,
    createDocument,
    updateLocal,
    saveDocument: saveCurrentDocument,
    deleteDocument,
    refreshList,
  } = useDocuments();

  // 处理文档移动（移动后刷新列表）
  const handleMoveDocument = useCallback(async () => {
    await refreshList();
  }, [refreshList]);

  // 处理文档重命名
  const handleRenameDocument = useCallback(
    (id: string, newTitle: string) => {
      // 如果是当前选中的文档，直接更新本地状态
      if (id === selectedDocId) {
        updateLocal({ title: newTitle });
      }
      // 刷新列表以显示新标题
      refreshList();
    },
    [selectedDocId, updateLocal, refreshList]
  );

  const [writingSidebarCollapsed, setWritingSidebarCollapsed] = useState(false);

  // Welcome guide state - show on first time or when manually triggered
  const [showWelcomeGuide, setShowWelcomeGuide] = useState(false);

  // Version history panel state
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  // Get current mode configuration
  const modeConfig = APP_MODE_CONFIGS[appState.mode];

  // Check if in focus mode (writing mode with focus feature)
  const isInFocusMode = appState.mode === 'writing' && appState.writingFeature === 'focus';

  // Initialize AI config service
  useEffect(() => {
    aiConfigService.initialize().catch(console.error);
  }, []);

  // Initialize documents when entering writing mode
  useEffect(() => {
    if (appState.mode === 'writing' && !documentsInitialized) {
      initializeDocuments();
    }
  }, [appState.mode, documentsInitialized, initializeDocuments]);

  // Show welcome guide for first-time users (when documents list is empty and not dismissed before)
  useEffect(() => {
    if (
      appState.mode === 'writing' &&
      documentsInitialized &&
      isFirstTime &&
      !wasWelcomeGuideDismissed()
    ) {
      setShowWelcomeGuide(true);
    }
  }, [appState.mode, documentsInitialized, isFirstTime]);

  // Handler to open welcome guide (for ? button)
  const handleOpenWelcomeGuide = useCallback(() => {
    setShowWelcomeGuide(true);
  }, []);

  // Handler to close welcome guide
  const handleCloseWelcomeGuide = useCallback(() => {
    setShowWelcomeGuide(false);
  }, []);

  // Create a new document - wrapper around hook's createDocument
  // Uses the folderId parameter if provided
  // 支持文件类型选项（Markdown、LaTeX、纯文本）
  const createNewDocument = useCallback(
    async (folderId?: string | null, options?: CreateDocumentOptions) => {
      // 根据文件类型获取正确的扩展名
      const fileType = options?.fileType ?? 'markdown';
      const typeConfig = fileTypeRegistry.get(fileType as DocumentTypeId);
      const extension = typeConfig?.defaultExtension ?? '.md';

      // 如果提供了 title 则使用，否则使用默认标题
      // 确保文件名有正确的扩展名
      let documentTitle = options?.title;
      if (!documentTitle) {
        documentTitle = `无标题${extension}`;
      } else if (!documentTitle.endsWith(extension)) {
        // 如果提供的标题没有扩展名，自动添加
        const hasExtension = /\.[a-zA-Z0-9]+$/.test(documentTitle);
        if (!hasExtension) {
          documentTitle = `${documentTitle}${extension}`;
        }
      }

      await createDocument({
        title: documentTitle,
        content: options?.template ?? '',
        folderId: folderId ?? undefined,
      });
    },
    [createDocument]
  );

  // Handle title change - updates local state via hook
  // 保持原有文件扩展名，避免意外更改文件类型
  const handleTitleChange = useCallback(
    (newTitle: string) => {
      // 获取当前文档的原始扩展名
      const currentTitle = currentDocument?.title ?? '';
      const lastDot = currentTitle.lastIndexOf('.');
      const originalExtension = lastDot !== -1 ? currentTitle.slice(lastDot) : '';

      // 检查新标题是否已有扩展名
      const newLastDot = newTitle.lastIndexOf('.');
      const hasNewExtension = newLastDot !== -1 && newLastDot > newTitle.length - 6; // 扩展名不超过 5 个字符

      // 如果原标题有扩展名且新标题没有，则保持原扩展名
      let finalTitle = newTitle;
      if (originalExtension && !hasNewExtension) {
        // 去除新标题末尾的点（如果有）
        finalTitle = newTitle.replace(/\.+$/, '') + originalExtension;
      }

      updateLocal({ title: finalTitle });
    },
    [updateLocal, currentDocument?.title]
  );

  // 全局快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 编辑器已处理的按键（如 ⌘B 加粗、⌘I 斜体）不再触发全局快捷键
      if (e.defaultPrevented) return;

      // Skip if typing in input (except for some shortcuts)
      const target = e.target as HTMLElement;
      const isInputActive =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Cmd/Ctrl + N 打开快速输入（文本模式）
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'n') {
        e.preventDefault();
        dispatch({ type: 'OPEN_QUICK_INPUT', payload: 'text' });
        return;
      }

      // Cmd/Ctrl + Shift + R 打开快速输入（录音模式）
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'r') {
        e.preventDefault();
        dispatch({ type: 'OPEN_QUICK_INPUT', payload: 'voice' });
        return;
      }

      // Cmd/Ctrl + P 打开搜索
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        dispatch({ type: 'TOGGLE_SEARCH', payload: true });
        return;
      }

      // Cmd/Ctrl + , 打开设置
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        dispatch({ type: 'TOGGLE_SETTINGS', payload: true });
        return;
      }

      // Cmd/Ctrl + B 切换侧边栏
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        dispatch({ type: 'TOGGLE_SIDEBAR' });
        return;
      }

      // Cmd/Ctrl + S 保存 (in writing mode)
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        if (appState.mode === 'writing' && editorDirty) {
          e.preventDefault();
          saveCurrentDocument();
          return;
        }
      }

      // Escape - exit focus mode or close modals
      if (e.key === 'Escape') {
        if (appState.quickInputOpen) {
          dispatch({ type: 'TOGGLE_QUICK_INPUT', payload: false });
        } else if (appState.searchOpen) {
          dispatch({ type: 'TOGGLE_SEARCH', payload: false });
        } else if (appState.settingsOpen) {
          dispatch({ type: 'TOGGLE_SETTINGS', payload: false });
        } else if (isInFocusMode) {
          dispatch({ type: 'EXIT_FOCUS_MODE' });
        }
        return;
      }

      // Skip mode switching if in input
      if (isInputActive) return;

      // Mode switching shortcuts
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        switch (e.key) {
          case '1':
            e.preventDefault();
            dispatch({ type: 'SET_MODE', payload: 'knowledge' });
            break;
          case '2':
            e.preventDefault();
            dispatch({ type: 'SET_MODE', payload: 'writing' });
            break;
          case '3':
            e.preventDefault();
            dispatch({ type: 'SET_MODE', payload: 'reading' });
            break;
        }
      }

      // Cmd/Ctrl + Shift + F - Enter focus mode
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        dispatch({ type: 'ENTER_FOCUS_MODE' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    appState.mode,
    appState.writingFeature,
    appState.quickInputOpen,
    appState.searchOpen,
    appState.settingsOpen,
    editorDirty,
    isInFocusMode,
  ]);

  // 托盘菜单动作：与对应的全局快捷键行为一致
  useEffect(() => {
    const { tray } = window.electron;
    const unsubscribers = [
      tray.onQuickNote(() => dispatch({ type: 'OPEN_QUICK_INPUT', payload: 'text' })),
      tray.onOpenSearch(() => dispatch({ type: 'TOGGLE_SEARCH', payload: true })),
      tray.onSwitchMode((mode) => dispatch({ type: 'SET_MODE', payload: mode })),
      tray.onOpenSettings(() => dispatch({ type: 'TOGGLE_SETTINGS', payload: true })),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  // Apply mode changes
  useEffect(() => {
    document.documentElement.setAttribute('data-mode', appState.mode);
    document.documentElement.setAttribute('data-writing-feature', appState.writingFeature);
    if (modeConfig.ui.distractionFree || isInFocusMode) {
      document.body.classList.add('distraction-free');
    } else {
      document.body.classList.remove('distraction-free');
    }
  }, [appState.mode, appState.writingFeature, modeConfig, isInFocusMode]);

  // 处理快速输入提交：写入知识库并提交 Agent 处理
  const handleQuickInputSubmit = useCallback(
    async (data: QuickInputData) => {
      try {
        const { item, processing } = await captureQuickInput(data);
        dispatch({ type: 'TOGGLE_QUICK_INPUT', payload: false });
        await kb.reload();
        setSelectedKnowledgeItemId(item.id);
        if (processing === 'no-provider') {
          setNotice('已保存。尚未配置 AI 服务商，摘要与标签不会自动生成（设置 → AI 服务）');
        } else if (processing === 'submitted') {
          setNotice('已保存，AI 正在后台整理…');
        } else {
          setNotice('已保存');
        }
      } catch (error) {
        console.error('保存快速输入失败:', error);
        setNotice(`保存失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [kb.reload]
  );

  // Mode switch handler
  const handleModeChange = useCallback((mode: AppMode) => {
    dispatch({ type: 'SET_MODE', payload: mode });
  }, []);

  // 侧边栏文件夹：用户文件夹 + 条目数
  const virtualFolders = useMemo<VirtualFolder[]>(() => {
    const counts = new Map<string, number>();
    for (const item of kb.items) {
      if (item.folderId) counts.set(item.folderId, (counts.get(item.folderId) ?? 0) + 1);
    }
    return kb.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      type: 'manual',
      itemCount: counts.get(folder.id) ?? 0,
      children: [],
    }));
  }, [kb.items, kb.folders]);

  // 知识库工作区的范围
  const knowledgeScope = useMemo(() => {
    const preset = SMART_FOLDER_PRESETS.find((p) => p.id === selectedFolderId);
    if (preset) return { label: preset.name, rules: preset.rules };
    const folder = kb.folders.find((f) => f.id === selectedFolderId);
    return folder ? { label: folder.name, folderId: folder.id } : { label: '全部', rules: [] };
  }, [selectedFolderId, kb.folders]);

  const handleFolderSelect = useCallback((folderId: string) => {
    setSelectedFolderId(folderId);
  }, []);

  const handleCreateFolder = useCallback(async () => {
    try {
      await kb.createFolder(`新建文件夹 ${kb.folders.length + 1}`);
    } catch (error) {
      console.error('创建文件夹失败:', error);
    }
  }, [kb.createFolder, kb.folders.length]);

  // 知识库文件夹的重命名 / 删除确认对话框
  const [folderDialog, setFolderDialog] = useState<{
    action: 'rename' | 'delete';
    folder: VirtualFolder;
  } | null>(null);
  const closeFolderDialog = useCallback(() => setFolderDialog(null), []);

  /** 执行文件夹 / 条目归档操作，结果以轻提示反馈 */
  const runFolderAction = useCallback(
    async (action: () => Promise<void>, success: string, failure: string) => {
      try {
        await action();
        setNotice(success);
      } catch (error) {
        console.error(`${failure}:`, error);
        setNotice(`${failure}：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    []
  );

  const handleEditFolder = useCallback((folder: VirtualFolder) => {
    setFolderDialog({ action: 'rename', folder });
  }, []);

  const handleDeleteFolder = useCallback(
    (folderId: string) => {
      const folder = virtualFolders.find((f) => f.id === folderId);
      if (folder) setFolderDialog({ action: 'delete', folder });
    },
    [virtualFolders]
  );

  const confirmRenameFolder = useCallback(
    (name: string) => {
      if (!folderDialog) return;
      const { id } = folderDialog.folder;
      setFolderDialog(null);
      void runFolderAction(() => kb.renameFolder(id, name), `已重命名为「${name}」`, '重命名失败');
    },
    [folderDialog, kb.renameFolder, runFolderAction]
  );

  // 文件夹内的条目不删除，变为未归档；删除的是当前选中文件夹时回到「全部」
  const confirmDeleteFolder = useCallback(() => {
    if (!folderDialog) return;
    const { id, name } = folderDialog.folder;
    setFolderDialog(null);
    void runFolderAction(
      async () => {
        await kb.deleteFolder(id);
        setSelectedFolderId((current) => (current === id ? 'all' : current));
      },
      `已删除文件夹「${name}」`,
      '删除文件夹失败'
    );
  }, [folderDialog, kb.deleteFolder, runFolderAction]);

  /** 条目拖到侧边栏文件夹上：移动到该文件夹 */
  const handleDropItemOnFolder = useCallback(
    (folderId: string, itemId: string) => {
      const folder = kb.folders.find((f) => f.id === folderId);
      if (!folder) return;
      void runFolderAction(
        () => kb.updateItem(itemId, { folderId }),
        `已移动到「${folder.name}」`,
        '移动失败'
      );
    },
    [kb.folders, kb.updateItem, runFolderAction]
  );

  // ================================
  // 跨模式导航：知识库 ⇄ 写作 ⇄ 阅读
  // ================================

  /** 在写作模式中打开笔记 */
  const openInWriting = useCallback(
    (itemId: string) => {
      dispatch({ type: 'SET_MODE', payload: 'writing' });
      void selectDocument(itemId);
    },
    [selectDocument]
  );

  /** 在知识库中打开条目 */
  const openInKnowledge = useCallback((itemId: string) => {
    dispatch({ type: 'SET_MODE', payload: 'knowledge' });
    setSelectedKnowledgeItemId(itemId);
  }, []);

  /** 打开条目：笔记进入写作，其他类型在知识库中查看 */
  const openItem = useCallback(
    (itemId: string) => {
      const item = kb.items.find((i) => i.id === itemId);
      if (item?.type === 'note') openInWriting(itemId);
      else openInKnowledge(itemId);
    },
    [kb.items, openInWriting, openInKnowledge]
  );

  /** 由 [[双向链接]] 创建尚不存在的笔记 */
  const createNoteFromLink = useCallback(
    async (title: string) => {
      dispatch({ type: 'SET_MODE', payload: 'writing' });
      const document = await createDocument({
        title: ensureExtension(title.trim(), 'markdown'),
        content: `# ${title.trim()}\n`,
      });
      if (document) await kb.refreshItem(document.id);
    },
    [createDocument, kb.refreshItem]
  );

  /** 点击 [[双向链接]]：目标存在则打开，否则创建 */
  const openWikiTarget = useCallback(
    (target: string) => {
      const item = linkIndex.resolve(target);
      if (item) openItem(item.id);
      else void createNoteFromLink(target);
    },
    [linkIndex, openItem, createNoteFromLink]
  );

  /** 写作编辑器 [[ 补全的候选标题 */
  const linkTargets = useMemo(
    () => [...new Set(documentList.map((doc) => displayTitle(doc.title)))],
    [documentList]
  );

  /** Agent 浮窗中的条目标题 */
  const itemTitles = useMemo(
    () => new Map(kb.items.map((item) => [item.id, displayTitle(item.title)])),
    [kb.items]
  );
  const resolveItemTitle = useCallback((id: string) => itemTitles.get(id), [itemTitles]);

  // 文档保存后：同步 [[链接]] 到 links 表，并刷新知识库中的该条目（反向链接随之更新）
  // 只在保存完成时触发，最新的文档与索引通过 ref 读取
  const linkSyncRef = useRef({ linkIndex, currentDocument, selectedDocId, refresh: kb.refreshItem });
  linkSyncRef.current = { linkIndex, currentDocument, selectedDocId, refresh: kb.refreshItem };
  useEffect(() => {
    const { linkIndex: index, currentDocument: doc, selectedDocId: docId, refresh } =
      linkSyncRef.current;
    if (!lastSavedAt || !docId || !doc) return;
    const targetIds = new Set<string>();
    for (const link of extractWikiLinks(doc.content)) {
      const target = index.resolve(link.target);
      if (target && target.id !== docId) targetIds.add(target.id);
    }
    linkRepository
      .syncReferences(docId, [...targetIds])
      .then(() => refresh(docId))
      .catch((error) => console.error('同步双向链接失败:', error));
  }, [lastSavedAt]);

  // 切换文档时确保知识库中有该条目（新建文档后反向链接面板可立即使用）
  useEffect(() => {
    if (selectedDocId && !kb.items.some((item) => item.id === selectedDocId)) {
      void kb.refreshItem(selectedDocId);
    }
  }, [selectedDocId, kb.items, kb.refreshItem]);

  // ================================
  // 阅读模式
  // ================================

  const shelfItems = useMemo(() => kb.items.filter(isOnShelf), [kb.items]);
  const readingItem = useMemo(
    () => kb.items.find((item) => item.id === readingItemId) ?? null,
    [kb.items, readingItemId]
  );

  /** 阅读摘录：创建笔记、打标签并提交 AI 整理 */
  const handleCreateExcerpt = useCallback(
    async (input: CreateExcerptInput): Promise<string> => {
      const item = await knowledgeRepository.create({
        title: input.title,
        type: 'note',
        content: input.content,
        metadata: { excerptOf: input.sourceItemId },
      });
      if (input.tags.length > 0) await knowledgeRepository.setItemTags(item.id, input.tags);
      await kb.refreshItem(item.id);
      void requestProcessing(item);
      setNotice('摘录已保存到知识库');
      return item.id;
    },
    [kb.refreshItem]
  );

  // ================================
  // Editor Change Handler
  // Optimized to prevent cursor loss during auto-save
  //
  // Key design decisions:
  // 1. Use ref for updateLocal to avoid closure staleness
  // 2. Micro-debounce (16ms) to batch rapid changes without noticeable delay
  // 3. Skip duplicate content to avoid unnecessary state updates
  // 4. ProseMirror handles its own state - we just sync to React when needed
  // ================================

  // Stable ref for updateLocal to avoid recreating callback
  const updateLocalRef = useRef(updateLocal);
  updateLocalRef.current = updateLocal;

  // Refs for debouncing and tracking
  const pendingUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastContentRef = useRef<string>('');
  const lastDocIdRef = useRef<string | null>(null);

  // Reset content tracking when document changes
  useEffect(() => {
    if (selectedDocId !== lastDocIdRef.current) {
      lastDocIdRef.current = selectedDocId;
      lastContentRef.current = currentDocument?.content || '';

      // Clear any pending updates from the previous document
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current);
        pendingUpdateRef.current = null;
      }
    }
  }, [selectedDocId, currentDocument?.content]);

  // Stable editor change handler - never changes identity
  // Uses refs internally to always access latest values
  const handleEditorChange = useCallback((html: string) => {
    // Skip if content hasn't actually changed
    if (html === lastContentRef.current) {
      return;
    }

    // Store the new content immediately
    lastContentRef.current = html;

    // Clear any pending update
    if (pendingUpdateRef.current) {
      clearTimeout(pendingUpdateRef.current);
    }

    // Micro-debounce: batch rapid changes but stay responsive
    // 16ms is roughly one frame - imperceptible delay
    pendingUpdateRef.current = setTimeout(() => {
      pendingUpdateRef.current = null;
      // Use ref to get latest updateLocal function
      updateLocalRef.current({ content: html });
    }, 16);
  }, []); // Empty deps - uses refs for all external values

  // Cleanup pending updates on unmount
  useEffect(() => {
    return () => {
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current);
        pendingUpdateRef.current = null;
      }
    };
  }, []);

  // Get sidebar title based on mode
  const getSidebarTitle = () => {
    switch (appState.mode) {
      case 'reading':
        return '书库';
      case 'knowledge':
        return '知识库';
      case 'writing':
        return '文档';
    }
  };

  // Render sidebar content based on mode and active panel
  const renderSidebarContent = () => {
    if (appState.mode === 'knowledge') {
      // Show virtual folders for knowledge mode
      return (
        <VirtualFolders
          folders={virtualFolders}
          items={kb.items}
          selectedFolderId={selectedFolderId}
          onFolderSelect={handleFolderSelect}
          onCreateFolder={handleCreateFolder}
          onEditFolder={handleEditFolder}
          onDeleteFolder={handleDeleteFolder}
          onDropItem={handleDropItemOnFolder}
        />
      );
    }

    if (appState.mode === 'reading') {
      return (
        <ReadingShelf items={shelfItems} selectedId={readingItemId} onSelect={setReadingItemId} />
      );
    }

    // 写作模式：使用统一树结构的 WritingSidebar
    return (
        <WritingSidebar
          documents={documentList}
          selectedDocId={selectedDocId}
          documentsLoading={documentsLoading}
          isCollapsed={writingSidebarCollapsed}
          onToggleCollapse={() => setWritingSidebarCollapsed(!writingSidebarCollapsed)}
          onSelectDocument={selectDocument}
          onCreateDocument={createNewDocument}
          onDeleteDocument={deleteDocument}
          onOpenHelp={handleOpenWelcomeGuide}
          onMoveDocument={handleMoveDocument}
          onRenameDocument={handleRenameDocument}
        />
    );
  };

  // Word count calculations - now from useDocuments hook
  const focusWordCount = docWordCount;
  const focusCharCount = docCharCount;

  // Render main content based on mode
  const renderMainContent = () => {
    switch (appState.mode) {
      case 'reading':
        return (
          <div className="reading-content">
            <ReadingView
              key={readingItem?.id ?? 'empty'}
              item={readingItem}
              onUpdateItem={kb.updateItem}
              onCreateExcerpt={handleCreateExcerpt}
              onOpenInWriting={openInWriting}
              onWikiLinkClick={openWikiTarget}
            />
          </div>
        );

      case 'knowledge':
        return (
          <div className="knowledge-content">
            <KnowledgeWorkspace
              kb={kb}
              scope={knowledgeScope}
              linkIndex={linkIndex}
              related={relatedLinks}
              selectedItemId={selectedKnowledgeItemId}
              onSelectItem={setSelectedKnowledgeItemId}
              onOpenInWriting={openInWriting}
              onCreateNote={(title) => void createNoteFromLink(title)}
              onQuickCapture={() => dispatch({ type: 'OPEN_QUICK_INPUT', payload: 'text' })}
              onOpenSettings={() => dispatch({ type: 'TOGGLE_SETTINGS', payload: true })}
            />
          </div>
        );

      case 'writing':
        // Only render editor when document is loaded to prevent stale content
        const canRenderEditor = selectedDocId && currentDocument && !editorLoading;
        const currentKnowledgeItem = kb.items.find((item) => item.id === selectedDocId);

        return (
          <div className="writing-content">
            <div className="writing-body">
            <div className="writing-editor-wrapper">
              {editorLoading ? (
                <div className="editor-loading">
                  <p>加载中...</p>
                </div>
              ) : canRenderEditor ? (
                <Suspense fallback={<EditorLoadingFallback />}>
                  <RichEditor
                    key={`${selectedDocId}-${currentDocument.id}`}
                    initialContent={currentDocument.content}
                    onChange={handleEditorChange}
                    fileType={getFileTypeId(currentDocument.title)}
                    fileName={currentDocument.title}
                    linkTargets={linkTargets}
                    onWikiLinkClick={openWikiTarget}
                    options={{
                      placeholder: PLACEHOLDERS.CONTENT,
                      showWordCount: false,
                      showToolbar: false,
                      showBorder: false,
                      typewriterMode: appState.writingFeature === 'typewriter',
                      focusMode: false,
                      showTitle: true,
                      title: currentDocument.title,
                      titlePlaceholder: PLACEHOLDERS.TITLE,
                      onTitleChange: handleTitleChange,
                    }}
                  />
                </Suspense>
              ) : (
                <div className="editor-empty">
                  <PenTool size={48} strokeWidth={1} />
                  <p>选择或创建一个文档开始写作</p>
                </div>
              )}
            </div>
            {showBacklinks && canRenderEditor && currentKnowledgeItem && (
              <BacklinksPanel
                item={currentKnowledgeItem}
                items={kb.items}
                linkIndex={linkIndex}
                related={relatedLinks}
                onOpenItem={openItem}
                onCreateNote={(title) => void createNoteFromLink(title)}
                onClose={() => setShowBacklinks(false)}
              />
            )}
            </div>
            <EditorFooter
              charCount={focusCharCount}
              wordCount={focusWordCount}
              isDirty={editorDirty}
              isSaving={isSaving}
              lastSavedAt={lastSavedAt}
              showHints={true}
              hints={[{ key: '⌘S', label: '保存' }]}
              className="writing-footer"
            >
              {/* 反向链接面板开关 */}
              {selectedDocId && (
                <button
                  className={`footer-action-btn ${showBacklinks ? 'active' : ''}`}
                  onClick={() => setShowBacklinks(!showBacklinks)}
                  title="反向链接与局部图谱"
                >
                  <Link2 size={14} />
                  {currentKnowledgeItem && (
                    <span>{linkIndex.backlinks(currentKnowledgeItem.id).length}</span>
                  )}
                </button>
              )}
              {/* Version History Button */}
              {selectedDocId && (
                <button
                  className="footer-action-btn"
                  onClick={() => setShowVersionHistory(true)}
                  title="版本历史"
                >
                  <History size={14} />
                </button>
              )}
            </EditorFooter>

            {/* Version History Panel */}
            <VersionHistory
              itemId={selectedDocId || ''}
              isOpen={showVersionHistory}
              currentContent={currentDocument?.content ?? ''}
              onClose={() => setShowVersionHistory(false)}
              onRestore={() => {
                // 版本恢复后强制重新加载文档内容
                reloadDocument();
              }}
            />
          </div>
        );

      default:
        return null;
    }
  };

  // Focus mode render - clean, distraction-free with RichEditor
  if (isInFocusMode) {
    return (
      <div className="app focus-mode">
        <div className="focus-container">
          {/* Minimal header with close button */}
          <div className="focus-header">
            <TitleInput
              className="focus-title-input"
              value={currentDocument?.title ?? ''}
              documentId={selectedDocId}
              onChange={handleTitleChange}
              placeholder={PLACEHOLDERS.TITLE}
            />
            <button
              className="focus-close"
              onClick={() => dispatch({ type: 'EXIT_FOCUS_MODE' })}
              title="退出专注模式 (Esc)"
            >
              <X size={18} />
            </button>
          </div>

          {/* Main editor - RichEditor without toolbar */}
          <div className="focus-content">
            {currentDocument ? (
              <Suspense fallback={<EditorLoadingFallback />}>
                <RichEditor
                  key={`focus-${selectedDocId}-${currentDocument.id}`}
                  initialContent={currentDocument.content}
                  onChange={handleEditorChange}
                  fileType={getFileTypeId(currentDocument.title)}
                  fileName={currentDocument.title}
                  linkTargets={linkTargets}
                  onWikiLinkClick={openWikiTarget}
                  options={{
                    placeholder: PLACEHOLDERS.FOCUS_CONTENT,
                    showWordCount: false,
                    showToolbar: false,
                    showBorder: false,
                    focusMode: true,
                    minHeight: '100%',
                    contentMaxWidth: '720px',
                    showTitle: false,
                  }}
                />
              </Suspense>
            ) : (
              <div className="editor-loading">
                <p>加载中...</p>
              </div>
            )}
          </div>

          {/* Footer with stats - using shared EditorFooter component */}
          <EditorFooter
            charCount={focusCharCount}
            wordCount={focusWordCount}
            isDirty={editorDirty}
            isSaving={isSaving}
            lastSavedAt={lastSavedAt}
            showHints={true}
            hints={[
              { key: 'Esc', label: '退出' },
              { key: '⌘S', label: '保存' },
            ]}
            className="focus-footer"
          >
            {/* Version History Button */}
            {selectedDocId && (
              <button
                className="footer-action-btn"
                onClick={() => setShowVersionHistory(true)}
                title="版本历史"
              >
                <History size={14} />
              </button>
            )}
          </EditorFooter>

          {/* Version History Panel in Focus Mode */}
          <VersionHistory
            itemId={selectedDocId || ''}
            isOpen={showVersionHistory}
            currentContent={currentDocument?.content ?? ''}
            onClose={() => setShowVersionHistory(false)}
            onRestore={() => {
              // 版本恢复后强制重新加载文档内容
              reloadDocument();
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <Layout
      onQuickInput={() => dispatch({ type: 'OPEN_QUICK_INPUT', payload: 'text' })}
      onStartRecording={() => dispatch({ type: 'OPEN_QUICK_INPUT', payload: 'voice' })}
      currentMode={appState.mode}
      onModeChange={handleModeChange}
      onOpenSearch={() => dispatch({ type: 'TOGGLE_SEARCH', payload: true })}
      onOpenSettings={() => dispatch({ type: 'TOGGLE_SETTINGS', payload: true })}
      onEnterFocusMode={() => dispatch({ type: 'ENTER_FOCUS_MODE' })}
      isInFocusMode={isInFocusMode}
    >
      <div className="app-content">
        {/* Sidebar */}
        {modeConfig.ui.showSidebar && appState.sidebarVisible && (
          <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
            {/* Explorer Section */}
            <div className="sidebar-section">
              <div
                className="sidebar-section-header"
                onClick={() => setExplorerExpanded(!explorerExpanded)}
              >
                <span className="section-toggle">
                  {explorerExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </span>
                <span className="section-title">{getSidebarTitle()}</span>
              </div>

              {explorerExpanded && (
                <div className="sidebar-section-content">{renderSidebarContent()}</div>
              )}
            </div>

            {/* Quick Input Button - only show in non-writing modes */}
            {appState.mode !== 'writing' && (
              <div className="sidebar-footer">
                <button
                  className="quick-input-trigger"
                  onClick={() => dispatch({ type: 'TOGGLE_QUICK_INPUT', payload: true })}
                  title="快速输入 (⌘N)"
                >
                  <Plus size={16} />
                  <span>快速输入</span>
                </button>
              </div>
            )}

            {/* Resize Handle */}
            <div className="sidebar-resizer" />
          </aside>
        )}

        {/* Main Content */}
        <main className="main-content">{renderMainContent()}</main>
      </div>

      {/* Quick Input Modal */}
      <QuickInput
        isOpen={appState.quickInputOpen}
        onClose={() => dispatch({ type: 'TOGGLE_QUICK_INPUT', payload: false })}
        onSubmit={handleQuickInputSubmit}
        initialMode={appState.quickInputMode}
      />

      {/* Search Panel */}
      <SearchPanel
        isOpen={appState.searchOpen}
        onClose={() => dispatch({ type: 'TOGGLE_SEARCH', payload: false })}
        onOpenDocument={openInWriting}
        onOpenKnowledgeItem={openInKnowledge}
      />

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={appState.settingsOpen}
        onClose={() => dispatch({ type: 'TOGGLE_SETTINGS', payload: false })}
      />

      {/* Welcome Guide Modal (for writing mode) */}
      <WelcomeGuide
        isOpen={showWelcomeGuide}
        onClose={handleCloseWelcomeGuide}
        persistDismissal={isFirstTime}
      />

      {/* AI 后台任务进度（任意模式可见） */}
      <AgentActivityPanel resolveTitle={resolveItemTitle} onOpenItem={openInKnowledge} />

      {/* 知识库文件夹重命名 / 删除 */}
      <InputDialog
        isOpen={folderDialog?.action === 'rename'}
        title="重命名文件夹"
        placeholder="请输入文件夹名称"
        defaultValue={folderDialog?.folder.name ?? ''}
        onConfirm={confirmRenameFolder}
        onCancel={closeFolderDialog}
      />
      <ConfirmDialog
        isOpen={folderDialog?.action === 'delete'}
        title="删除文件夹"
        message={`确定删除文件夹「${folderDialog?.folder.name ?? ''}」吗？其中的 ${folderDialog?.folder.itemCount ?? 0} 个条目不会被删除，将变为未归档。`}
        confirmText="删除"
        isDanger
        onConfirm={confirmDeleteFolder}
        onCancel={closeFolderDialog}
      />

      {notice && (
        <div className="app-notice" role="status">
          {notice}
        </div>
      )}

    </Layout>
  );
};

export default App;

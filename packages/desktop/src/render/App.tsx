import React, { useState, useEffect, useCallback, useReducer, useRef, Suspense, lazy } from 'react';
import Layout from './components/Layout';
import QuickInput, { QuickInputData } from './components/QuickInput';
import SearchPanel, { SearchResult } from './components/SearchPanel';
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

import VirtualFolders, { VirtualFolder, GroupByType } from './components/VirtualFolders';
import {
  useDocuments,
  PLACEHOLDERS,
  fileTypeRegistry,
  getFileTypeId,
  type DocumentTypeId,
} from './lib/documents';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Brain,
  BookOpen,
  PenTool,
  X,
  History,
} from 'lucide-react';
import { AppMode, APP_MODE_CONFIGS, appReducer, DEFAULT_APP_STATE } from './types/app-modes';
import { aiConfigService } from './services/aiConfigService';
import { knowledgeStorage } from './services/knowledgeStorage';
import './App.scss';

const App: React.FC = () => {
  // Use reducer for app state management
  const [appState, dispatch] = useReducer(appReducer, DEFAULT_APP_STATE);

  // Local UI state
  // 侧边栏折叠状态（当前固定为展开）
  const sidebarCollapsed = false;
  const [explorerExpanded, setExplorerExpanded] = useState(true);

  // 虚拟文件夹状态
  const [virtualFolders, setVirtualFolders] = useState<VirtualFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>();
  const [, setFoldersLoading] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupByType>('tags');

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

  // 加载虚拟文件夹数据
  useEffect(() => {
    const loadVirtualFolders = async () => {
      if (appState.mode !== 'knowledge') return;

      setFoldersLoading(true);
      try {
        const folders = await knowledgeStorage.getAllFolders();
        const items = await knowledgeStorage.getAllItems();

        // 将 Folder 转换为 VirtualFolder 格式
        const virtualFolderList: VirtualFolder[] = folders.map((folder) => ({
          id: folder.id,
          name: folder.name,
          type: (folder.type === 'smart' ? 'smart' : 'manual') as 'manual' | 'smart' | 'auto',
          icon: folder.icon,
          color: folder.color,
          itemCount: items.filter((item) => item.folderId === folder.id).length,
          children: [],
        }));

        setVirtualFolders(virtualFolderList);
      } catch (error) {
        console.error('加载虚拟文件夹失败:', error);
      } finally {
        setFoldersLoading(false);
      }
    };

    loadVirtualFolders();
  }, [appState.mode]);

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

  // 处理快速输入提交
  const handleQuickInputSubmit = useCallback(async (data: QuickInputData) => {
    try {
      // 1. 根据输入类型确定知识条目类型
      const typeMap: Record<string, 'note' | 'audio' | 'image' | 'file' | 'bookmark'> = {
        text: 'note',
        voice: 'audio',
        image: 'image',
        file: 'file',
        url: 'bookmark',
      };
      const itemType = typeMap[data.type] || 'note';

      // 2. 保存附件并获取路径
      const attachmentPaths: string[] = [];
      if (data.attachments && data.attachments.length > 0) {
        for (const file of data.attachments) {
          const filePath = await knowledgeStorage.saveAttachment(file);
          attachmentPaths.push(filePath);
        }
      }

      // 3. 创建知识条目
      const item = await knowledgeStorage.createItem({
        title: data.title || '快速笔记',
        type: itemType,
        content: data.content,
        sourceUrl: data.sourceUrl,
        folderId: data.folderId,
        filePath: attachmentPaths[0], // 主附件路径
      });

      // 4. 处理标签
      if (data.tags && data.tags.length > 0) {
        const tagIds: string[] = [];
        for (const tagName of data.tags) {
          const tag = await knowledgeStorage.findOrCreateTag(tagName);
          tagIds.push(tag.id);
        }
        // 更新条目的标签
        await knowledgeStorage.updateItem(item.id, { tagIds });
      }

      // 5. 关闭快速输入面板
      dispatch({ type: 'TOGGLE_QUICK_INPUT' });
    } catch (error) {
      console.error('保存快速输入失败:', error);
    }
  }, []);

  // Mode switch handler
  const handleModeChange = useCallback((mode: AppMode) => {
    dispatch({ type: 'SET_MODE', payload: mode });
  }, []);

  // 搜索结果选择处理
  const handleSearchResultSelect = useCallback(
    (result: SearchResult) => {
      // 根据结果类型导航到对应位置
      if (result.type === 'note' || result.type === 'document') {
        // 切换到写作模式并选择文档
        dispatch({ type: 'SET_MODE', payload: 'writing' });
        selectDocument(result.id);
      } else {
        // 其他类型（录音、图片、代码片段、网页等）进入知识库模式
        dispatch({ type: 'SET_MODE', payload: 'knowledge' });
      }
      // 关闭搜索面板
      dispatch({ type: 'TOGGLE_SEARCH' });
    },
    [selectDocument]
  );

  // 文件夹选择处理 - 筛选知识库项目
  const handleFolderSelect = useCallback(async (folderId: string) => {
    setSelectedFolderId(folderId);

    // 根据文件夹 ID 筛选知识库项目
    try {
      const allItems = await knowledgeStorage.getAllItems();
      const filteredItems = folderId
        ? allItems.filter((item) => item.folderId === folderId)
        : allItems;

      // 更新虚拟文件夹的项目计数（如果需要显示）
      console.log(`已筛选 ${filteredItems.length} 个项目`);
    } catch (error) {
      console.error('筛选文件夹项目失败:', error);
    }
  }, []);

  // 创建虚拟文件夹
  const handleCreateFolder = useCallback(async () => {
    try {
      const folderName = `新建文件夹 ${virtualFolders.length + 1}`;
      const newFolder = await knowledgeStorage.createFolder(folderName);

      // 添加到列表
      const newVirtualFolder: VirtualFolder = {
        id: newFolder.id,
        name: newFolder.name,
        type: 'manual',
        icon: newFolder.icon,
        color: newFolder.color,
        itemCount: 0,
        children: [],
      };
      setVirtualFolders((prev) => [...prev, newVirtualFolder]);
    } catch (error) {
      console.error('创建文件夹失败:', error);
    }
  }, [virtualFolders.length]);

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
          selectedFolderId={selectedFolderId}
          groupBy={groupBy}
          onFolderSelect={handleFolderSelect}
          onGroupByChange={setGroupBy}
          onCreateFolder={handleCreateFolder}
        />
      );
    }

    if (appState.mode === 'reading') {
      // Reading mode - book library
      return (
        <div className="reading-sidebar">
          <div className="empty-hint">
            <BookOpen size={32} strokeWidth={1} />
            <p>阅读管理开发中</p>
          </div>
        </div>
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
            <div className="empty-state">
              <BookOpen size={48} strokeWidth={1} />
              <h2>阅读模式</h2>
              <p>文章、电子书的阅读管理正在开发中</p>
            </div>
          </div>
        );

      case 'knowledge':
        return (
          <div className="knowledge-content">
            <div className="empty-state">
              <Brain size={48} strokeWidth={1} />
              <h2>欢迎使用知识库</h2>
              <p>按 ⌘N 快速添加笔记、录音或网页剪藏</p>
              <button
                className="start-btn"
                onClick={() => dispatch({ type: 'OPEN_QUICK_INPUT', payload: 'text' })}
              >
                <Plus size={16} />
                <span>开始创建</span>
              </button>
            </div>
          </div>
        );

      case 'writing':
        // Only render editor when document is loaded to prevent stale content
        const canRenderEditor = selectedDocId && currentDocument && !editorLoading;

        return (
          <div className="writing-content">
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
        onResultSelect={handleSearchResultSelect}
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

    </Layout>
  );
};

export default App;

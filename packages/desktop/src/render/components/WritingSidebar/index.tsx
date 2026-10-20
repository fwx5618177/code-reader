// ================================
// WritingSidebar 组件
// 统一的文件夹和文档树结构（VS Code 风格）
// 使用 useWritingFileTree 进行文件系统抽象
// 使用 VirtualizedTreeView 高效渲染大型树
// 支持拖放、文件夹选择和 VSCode 风格交互
// 集成全局搜索功能
// 支持多种文件类型创建（Markdown、LaTeX、纯文本）
// 支持加载 LaTeX 示例进行大文件和 Tree-sitter 测试
// ================================

// LaTeX 示例内容（内联导入，确保可用）
import sampleTexContent from '../../../../assets/examples/sample.tex?raw';
import largeDocumentTexContent from '../../../../assets/examples/large-document.tex?raw';
import hugeDocumentTexContent from '../../../../assets/examples/huge-document.tex?raw';

import React, { useState, useCallback, useEffect, useMemo, useRef, memo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  HelpCircle,
  File,
  FileText,
  FileCode,
  FolderPlus,
  Trash2,
  Search,
  X,
  FlaskConical,
} from 'lucide-react';
import { databaseService } from '../../services/database';
import { useWritingFileTree, DropPosition } from '../../lib/file-system';
import {
  DocumentListItem,
  DocumentTypeId,
  getCreatableTypes,
  getDefaultTemplate,
  FileTypeConfig,
} from '../../lib/documents';
import { useFolders } from '../../lib/folders';
import { useDocumentSearch } from '../../lib/writing/useWritingService';
import type { DocumentSearchResult } from '../../lib/writing/types';
import InputDialog, { ConfirmDialog } from '../InputDialog';
import { Snippet } from '../SearchPanel/Snippet';
import { VirtualizedTreeView, NodeWithMeta } from './components';
import styles from './WritingSidebar.module.scss';

// ================================
// Props Interface
// ================================

/** 创建文档选项 */
export interface CreateDocumentOptions {
  /** 所属文件夹 ID */
  folderId?: string | null;
  /** 文档类型 */
  fileType?: DocumentTypeId;
  /** 初始内容模板 */
  template?: string;
  /** 文档标题（可选，不提供则使用默认标题） */
  title?: string;
}

export interface WritingSidebarProps {
  /** 文档列表 */
  documents: DocumentListItem[];
  /** 当前选中的文档 ID */
  selectedDocId: string | null;
  /** 文档是否正在加载 */
  documentsLoading: boolean;
  /** 侧边栏内容是否折叠 */
  isCollapsed: boolean;
  /** 折叠切换回调 */
  onToggleCollapse: () => void;
  /** 文档选择回调 */
  onSelectDocument: (id: string) => void;
  /** 新建文档回调（支持文件类型选项） */
  onCreateDocument: (folderId?: string | null, options?: CreateDocumentOptions) => void;
  /** 删除文档回调 */
  onDeleteDocument: (id: string) => void;
  /** 帮助按钮回调 */
  onOpenHelp: () => void;
  /** 文档移动完成回调（用于刷新列表等操作） */
  onMoveDocument?: () => void;
  /** 文档重命名回调 */
  onRenameDocument?: (id: string, newTitle: string) => void;
  /** 清空数据回调 */
  onClearAllData?: () => void;
}

// ================================
// Dialog State Types
// ================================

/** 输入对话框状态 */
interface InputDialogState {
  isOpen: boolean;
  title: string;
  placeholder: string;
  defaultValue: string;
  onConfirm: (value: string) => void;
}

/** 确认对话框状态 */
interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  isDanger: boolean;
  onConfirm: () => void;
}

const initialInputDialogState: InputDialogState = {
  isOpen: false,
  title: '',
  placeholder: '',
  defaultValue: '',
  onConfirm: () => {},
};

const initialConfirmDialogState: ConfirmDialogState = {
  isOpen: false,
  title: '',
  message: '',
  isDanger: false,
  onConfirm: () => {},
};

/** 文件类型选择对话框状态 */
interface FileTypeDialogState {
  isOpen: boolean;
  folderId: string | null;
}

const initialFileTypeDialogState: FileTypeDialogState = {
  isOpen: false,
  folderId: null,
};

/** LaTeX 示例配置 */
interface LatexExampleConfig {
  /** 示例 ID */
  id: string;
  /** 示例名称 */
  name: string;
  /** 示例描述 */
  description: string;
  /** 文件大小（字节） */
  size: number;
  /** 示例类型标签 */
  tag: 'small' | 'large' | 'huge';
  /** 示例内容 */
  content: string;
}

/** 可用的 LaTeX 示例（使用内联导入的内容） */
const LATEX_EXAMPLES: LatexExampleConfig[] = [
  {
    id: 'sample',
    name: '标准示例',
    description: '包含基本 LaTeX 功能的小型文档',
    size: sampleTexContent.length,
    tag: 'small',
    content: sampleTexContent,
  },
  {
    id: 'large-document',
    name: '大型文档',
    description: '中等大小的文档，测试渲染性能',
    size: largeDocumentTexContent.length,
    tag: 'large',
    content: largeDocumentTexContent,
  },
  {
    id: 'huge-document',
    name: '超大文档',
    description: '测试 Tree-sitter 增量解析和 Web Worker',
    size: hugeDocumentTexContent.length,
    tag: 'huge',
    content: hugeDocumentTexContent,
  },
];

/** 示例选择对话框状态 */
interface ExampleDialogState {
  isOpen: boolean;
}

const initialExampleDialogState: ExampleDialogState = {
  isOpen: false,
};

/** 获取文件类型图标组件 */
function getFileTypeIcon(icon: string, size = 16) {
  switch (icon) {
    case 'FileText':
      return <FileText size={size} />;
    case 'FileCode':
      return <FileCode size={size} />;
    case 'File':
    default:
      return <File size={size} />;
  }
}

// ================================
// Main Component
// ================================

const WritingSidebar: React.FC<WritingSidebarProps> = ({
  documents,
  selectedDocId,
  documentsLoading,
  isCollapsed,
  onToggleCollapse,
  onSelectDocument,
  onCreateDocument,
  onDeleteDocument,
  onOpenHelp,
  onMoveDocument,
  onRenameDocument,
  onClearAllData,
}) => {
  // 对话框状态
  const [inputDialog, setInputDialog] = useState<InputDialogState>(initialInputDialogState);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(initialConfirmDialogState);
  const [fileTypeDialog, setFileTypeDialog] = useState<FileTypeDialogState>(
    initialFileTypeDialogState
  );
  const [exampleDialog, setExampleDialog] = useState<ExampleDialogState>(initialExampleDialogState);
  const [loadingExample, setLoadingExample] = useState<string | null>(null);

  // 可用的文件类型列表
  const creatableTypes = useMemo(() => getCreatableTypes(), []);

  // 当前选中的文件夹（用于"在文件夹中创建"操作）
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  // 清空数据确认状态
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // 搜索相关状态
  const [isSearchMode, setIsSearchMode] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 使用文档搜索 Hook
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    results: searchResults,
    isSearching,
    isInitialized: isSearchInitialized,
  } = useDocumentSearch({ limit: 20, highlight: true, snippetLength: 80 });

  // 文件夹操作 Hook
  const {
    folders,
    loading: foldersLoading,
    error: foldersError,
    createFolder: createFolderInternal,
    renameFolder: renameFolderInternal,
    deleteFolder: deleteFolderInternal,
    moveDocumentToFolder: moveDocumentToFolderInternal,
    moveFolder: moveFolderInternal,
  } = useFolders();

  // 文件树 Hook
  const {
    visibleNodes,
    isLoading,
    selectedDocumentId,
    selectedFolderId,
    isExpanded,
    toggle,
    expand,
    select,
    clearSelection,
    getNodeMeta,
    getAncestors,
    selectDocument,
    createNewFolder,
    deleteFolderById,
    renameFolderById,
    moveDocumentToFolder,
    expandToDocument,
  } = useWritingFileTree({
    folders,
    documents,
    foldersLoading,
    foldersError,
    initialSelectedDocumentId: selectedDocId,
    createFolder: async (name, parentId) => {
      return createFolderInternal({ name, parentId });
    },
    renameFolder: renameFolderInternal,
    deleteFolder: deleteFolderInternal,
    moveDocument: moveDocumentToFolderInternal,
    onSelectDocument: (doc) => {
      onSelectDocument(doc.id);
      setActiveFolderId(null); // 选中文档时清除文件夹选择
    },
    onSelectFolder: (folder) => {
      // 选中文件夹时更新活跃文件夹
      setActiveFolderId(folder?.id ?? null);
    },
  });

  // 同步外部选择与内部状态
  useEffect(() => {
    if (selectedDocId && selectedDocId !== selectedDocumentId) {
      selectDocument(selectedDocId);
      expandToDocument(selectedDocId);
    }
  }, [selectedDocId, selectedDocumentId, selectDocument, expandToDocument]);

  // 搜索模式切换时聚焦输入框
  useEffect(() => {
    if (isSearchMode && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearchMode]);

  // 关闭输入对话框
  const closeInputDialog = useCallback(() => {
    setInputDialog(initialInputDialogState);
  }, []);

  // 关闭确认对话框
  const closeConfirmDialog = useCallback(() => {
    setConfirmDialog(initialConfirmDialogState);
  }, []);

  // 切换搜索模式
  const toggleSearchMode = useCallback(() => {
    setIsSearchMode((prev) => {
      if (prev) {
        // 退出搜索模式时清空搜索词
        setSearchQuery('');
      }
      return !prev;
    });
  }, [setSearchQuery]);

  // 处理搜索输入变化
  const handleSearchInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    [setSearchQuery]
  );

  // 处理搜索结果选择
  const handleSearchResultSelect = useCallback(
    (result: DocumentSearchResult) => {
      onSelectDocument(result.documentId);
      // 选择后退出搜索模式
      setIsSearchMode(false);
      setSearchQuery('');
    },
    [onSelectDocument, setSearchQuery]
  );

  // 处理搜索框键盘事件
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        setIsSearchMode(false);
        setSearchQuery('');
      } else if (e.key === 'Enter' && searchResults.length > 0) {
        handleSearchResultSelect(searchResults[0]);
      }
    },
    [searchResults, handleSearchResultSelect, setSearchQuery]
  );

  // 清空搜索
  const clearSearch = useCallback(() => {
    setSearchQuery('');
    searchInputRef.current?.focus();
  }, [setSearchQuery]);

  // 创建根文件夹
  const handleCreateRootFolder = useCallback(() => {
    setInputDialog({
      isOpen: true,
      title: '新建文件夹',
      placeholder: '请输入文件夹名称',
      defaultValue: '',
      onConfirm: async (name: string) => {
        await createNewFolder(name, null);
        closeInputDialog();
      },
    });
  }, [createNewFolder, closeInputDialog]);

  // 打开文件类型选择对话框
  const openFileTypeDialog = useCallback((folderId: string | null) => {
    setFileTypeDialog({
      isOpen: true,
      folderId,
    });
  }, []);

  // Handle create subfolder
  const handleCreateSubfolder = useCallback(
    (parentId: string) => {
      const meta = getNodeMeta(parentId);
      const folderId = meta?.nodeType === 'folder' ? meta.folder?.id : null;

      setInputDialog({
        isOpen: true,
        title: '新建子文件夹',
        placeholder: '请输入文件夹名称',
        defaultValue: '',
        onConfirm: async (name: string) => {
          await createNewFolder(name, folderId);
          expand(parentId);
          closeInputDialog();
        },
      });
    },
    [createNewFolder, expand, closeInputDialog, getNodeMeta]
  );

  // Handle create document in folder
  const handleCreateDocumentInFolder = useCallback(
    (nodeId: string) => {
      const meta = getNodeMeta(nodeId);
      const folderId = meta?.nodeType === 'folder' ? meta.folder?.id : null;
      expand(nodeId);
      openFileTypeDialog(folderId ?? null);
    },
    [expand, openFileTypeDialog, getNodeMeta]
  );

  // Handle start edit (rename)
  const handleStartEdit = useCallback(
    (nodeId: string, currentName: string) => {
      const meta = getNodeMeta(nodeId);
      if (!meta) return;

      const nodeIsFolder = meta.nodeType === 'folder';

      // 获取原始文件名（带扩展名）以便稍后恢复扩展名
      const originalFileName = meta.document?.title ?? '';
      // 提取原始扩展名
      const lastDotIndex = originalFileName.lastIndexOf('.');
      const originalExtension = lastDotIndex !== -1 ? originalFileName.slice(lastDotIndex) : '';

      setInputDialog({
        isOpen: true,
        title: nodeIsFolder ? '重命名文件夹' : '重命名文档',
        placeholder: '请输入新名称',
        defaultValue: currentName,
        onConfirm: async (newName: string) => {
          if (nodeIsFolder && meta.folder) {
            await renameFolderById(meta.folder.id, newName);
          } else if (!nodeIsFolder && meta.document && onRenameDocument) {
            // 重命名文档时保持原有扩展名
            // 检查新名称是否已包含扩展名
            const hasExtension = /\.[a-zA-Z0-9]+$/.test(newName);
            const finalName = hasExtension ? newName : newName + originalExtension;
            onRenameDocument(meta.document.id, finalName);
          }
          closeInputDialog();
        },
      });
    },
    [getNodeMeta, renameFolderById, closeInputDialog, onRenameDocument]
  );

  // Handle delete
  const handleDelete = useCallback(
    (nodeId: string, name: string, type: 'folder' | 'document') => {
      const meta = getNodeMeta(nodeId);
      const nodeIsFolder = type === 'folder';

      setConfirmDialog({
        isOpen: true,
        title: nodeIsFolder ? '删除文件夹' : '删除文档',
        message: nodeIsFolder
          ? `确定要删除文件夹"${name}"吗？文件夹内的文档将移动到根目录。`
          : `确定要删除文档"${name}"吗？`,
        isDanger: true,
        onConfirm: async () => {
          if (nodeIsFolder && meta?.folder) {
            await deleteFolderById(meta.folder.id);
          } else if (meta?.document) {
            onDeleteDocument(meta.document.id);
          }
          closeConfirmDialog();
        },
      });
    },
    [getNodeMeta, deleteFolderById, onDeleteDocument, closeConfirmDialog]
  );

  // Handle node selection
  // When a node is selected, we need to:
  // 1. Update internal selection state via select()
  // 2. Track folder selection for "create in folder" action
  // 3. Notify parent if it's a document
  const handleSelectNode = useCallback(
    (nodeId: string) => {
      select(nodeId);

      // Check node type and handle accordingly
      const meta = getNodeMeta(nodeId);
      if (meta?.nodeType === 'document' && meta.document) {
        onSelectDocument(meta.document.id);
        setActiveFolderId(null);
      } else if (meta?.nodeType === 'folder' && meta.folder) {
        setActiveFolderId(meta.folder.id);
        // Expand folder on selection for better UX
        expand(nodeId);
      }
    },
    [select, getNodeMeta, onSelectDocument, expand]
  );

  // Handle "All Documents" click - clear selection
  const handleShowAllDocuments = useCallback(() => {
    clearSelection();
    setActiveFolderId(null);
  }, [clearSelection]);

  // Handle toggle expand
  const handleToggleExpand = useCallback(
    (nodeId: string) => {
      toggle(nodeId);
    },
    [toggle]
  );

  // Check if a node is expanded (memoized for VirtualizedTreeView)
  const checkIsExpanded = useCallback(
    (nodeId: string) => {
      return isExpanded(nodeId);
    },
    [isExpanded]
  );

  // Check if a node is selected (memoized for VirtualizedTreeView)
  const checkIsSelected = useCallback(
    (nodeId: string) => {
      const meta = getNodeMeta(nodeId);
      if (meta?.nodeType === 'document') {
        return meta.document?.id === selectedDocumentId;
      }
      if (meta?.nodeType === 'folder') {
        return meta.folder?.id === selectedFolderId;
      }
      return false;
    },
    [getNodeMeta, selectedDocumentId, selectedFolderId]
  );

  // Get ancestor IDs for a node (for drag-drop validation)
  const getNodeAncestors = useCallback(
    (nodeId: string): string[] => {
      return getAncestors(nodeId);
    },
    [getAncestors]
  );

  // Handle node move via drag-drop
  const handleMoveNode = useCallback(
    async (sourceId: string, targetId: string, position: DropPosition) => {
      const sourceMeta = getNodeMeta(sourceId);
      const targetMeta = getNodeMeta(targetId);

      if (!sourceMeta || !targetMeta) return;

      // Determine the target folder ID
      let targetFolderId: string | null = null;

      if (position === 'inside') {
        // Dropping inside a folder
        if (targetMeta.nodeType === 'folder' && targetMeta.folder) {
          targetFolderId = targetMeta.folder.id;
        }
      } else {
        // Dropping before/after - use the target's parent folder
        if (targetMeta.folder?.parentId) {
          targetFolderId = targetMeta.folder.parentId;
        } else if (targetMeta.document?.folderId) {
          targetFolderId = targetMeta.document.folderId;
        }
        // If neither, targetFolderId remains null (root level)
      }

      // Handle document move
      if (sourceMeta.nodeType === 'document' && sourceMeta.document) {
        const success = await moveDocumentToFolder(sourceMeta.document.id, targetFolderId);
        if (success && onMoveDocument) {
          onMoveDocument();
        }
      }

      // 处理文件夹移动
      if (sourceMeta.nodeType === 'folder' && sourceMeta.folder) {
        const success = await moveFolderInternal(sourceMeta.folder.id, targetFolderId);
        if (success && onMoveDocument) {
          onMoveDocument();
        }
      }
    },
    [getNodeMeta, moveDocumentToFolder, moveFolderInternal, onMoveDocument]
  );

  // Compute node metadata for rendering - memoized for performance
  const nodesWithMeta: NodeWithMeta[] = useMemo(() => {
    return visibleNodes.map((flatNode) => {
      const meta = getNodeMeta(flatNode.node.id);
      return {
        flatNode,
        isFavorite: meta?.isFavorite,
        isPinned: meta?.isPinned,
      };
    });
  }, [visibleNodes, getNodeMeta]);

  // Check if loading
  const showLoading = (isLoading || documentsLoading) && visibleNodes.length === 0;
  const showEmptyState = !showLoading && visibleNodes.length === 0;
  const showTree = !showLoading && visibleNodes.length > 0;

  // 关闭文件类型选择对话框
  const closeFileTypeDialog = useCallback(() => {
    setFileTypeDialog(initialFileTypeDialogState);
  }, []);

  // 打开示例选择对话框
  const openExampleDialog = useCallback(() => {
    setExampleDialog({ isOpen: true });
  }, []);

  // 关闭示例选择对话框
  const closeExampleDialog = useCallback(() => {
    setExampleDialog(initialExampleDialogState);
  }, []);

  // 加载 LaTeX 示例（使用内联导入的内容，无需网络请求）
  const handleLoadExample = useCallback(
    async (exampleId: string) => {
      setLoadingExample(exampleId);

      try {
        // 从预加载的示例中获取内容
        const example = LATEX_EXAMPLES.find((e) => e.id === exampleId);
        if (!example) {
          throw new Error(`未找到示例: ${exampleId}`);
        }

        // 创建新文档并填充示例内容，使用示例 ID 作为文件名（确保是英文）
        await onCreateDocument(activeFolderId, {
          fileType: 'latex',
          template: example.content,
          title: `${example.id}.tex`,
        });

        closeExampleDialog();
      } catch (error) {
        console.error('[WritingSidebar] 加载示例失败:', error);
        alert(`加载示例失败: ${error instanceof Error ? error.message : '未知错误'}`);
      } finally {
        setLoadingExample(null);
      }
    },
    [onCreateDocument, activeFolderId, closeExampleDialog]
  );

  // 格式化文件大小
  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  // 获取示例标签样式类
  const getExampleTagClass = useCallback((tag: LatexExampleConfig['tag']): string => {
    switch (tag) {
      case 'small':
        return styles.exampleTagSmall;
      case 'large':
        return styles.exampleTagLarge;
      case 'huge':
        return styles.exampleTagHuge;
      default:
        return '';
    }
  }, []);

  // 选择文件类型并创建文档
  const handleSelectFileType = useCallback(
    (typeConfig: FileTypeConfig) => {
      const { folderId } = fileTypeDialog;
      const template = getDefaultTemplate(typeConfig.id);

      onCreateDocument(folderId, {
        folderId,
        fileType: typeConfig.id,
        template,
      });

      closeFileTypeDialog();
    },
    [fileTypeDialog, onCreateDocument, closeFileTypeDialog]
  );

  // 快捷创建默认类型（Markdown）
  const handleQuickCreateDocument = useCallback(() => {
    onCreateDocument(activeFolderId, {
      folderId: activeFolderId,
      fileType: 'markdown',
    });
  }, [onCreateDocument, activeFolderId]);

  // 显示文件类型选择对话框
  const handleCreateDocument = useCallback(() => {
    openFileTypeDialog(activeFolderId);
  }, [openFileTypeDialog, activeFolderId]);

  // Handle clear all data
  const handleClearAllData = useCallback(async () => {
    try {
      await databaseService.clearAllData();
      setShowClearConfirm(false);
      // Notify parent to refresh
      onClearAllData?.();
      // Force page reload to reset all state
      window.location.reload();
    } catch (error) {
      console.error('[WritingSidebar] Clear all data failed:', error);
      alert('清空数据失败，请重试');
    }
  }, [onClearAllData]);

  return (
    <div className={styles.writingSidebar}>
      {/* 头部区域 */}
      <div className={styles.sidebarHeader}>
        <div className={styles.headerLeft}>
          <span className={styles.sidebarTitle}>文档</span>
          <button
            className={styles.sidebarCollapseBtn}
            onClick={onToggleCollapse}
            title={isCollapsed ? '展开' : '折叠'}
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
        <div className={styles.headerActions}>
          {/* 搜索按钮 */}
          <button
            className={`${styles.headerActionBtn} ${styles.searchBtn} ${isSearchMode ? styles.active : ''}`}
            onClick={toggleSearchMode}
            title="搜索文档 (⌘F)"
          >
            <Search size={14} />
          </button>
          {/* 新建文档按钮（点击显示类型选择） */}
          <button
            className={`${styles.headerActionBtn} ${styles.newBtn}`}
            onClick={handleCreateDocument}
            onContextMenu={(e) => {
              e.preventDefault();
              handleQuickCreateDocument();
            }}
            title={
              activeFolderId
                ? '在当前文件夹中新建文档 (⌘N)\n右键快速创建 Markdown'
                : '新建文档 (⌘N)\n右键快速创建 Markdown'
            }
          >
            <Plus size={14} />
          </button>
          {/* 新建文件夹按钮 */}
          <button
            className={`${styles.headerActionBtn} ${styles.folderBtn}`}
            onClick={handleCreateRootFolder}
            title="新建文件夹"
          >
            <FolderPlus size={14} />
          </button>
          {/* 帮助按钮 */}
          <button
            className={`${styles.headerActionBtn} ${styles.helpBtn}`}
            onClick={onOpenHelp}
            title="使用帮助"
          >
            <HelpCircle size={14} />
          </button>
          {/* LaTeX 示例按钮 */}
          <button
            className={`${styles.headerActionBtn} ${styles.exampleBtn}`}
            onClick={openExampleDialog}
            title="加载 LaTeX 示例（测试大文件和 Tree-sitter）"
          >
            <FlaskConical size={14} />
          </button>
          {/* 清空数据按钮 */}
          <button
            className={`${styles.headerActionBtn} ${styles.dangerBtn}`}
            onClick={() => setShowClearConfirm(true)}
            title="清空所有数据"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* LaTeX 示例选择对话框 */}
      {exampleDialog.isOpen && (
        <div className={styles.dialogOverlay} onClick={closeExampleDialog}>
          <div className={styles.exampleDialog} onClick={(e) => e.stopPropagation()}>
            <div className={styles.exampleDialogHeader}>
              <h3>加载 LaTeX 示例</h3>
              <p>选择一个示例文档来测试 LaTeX 编辑器性能</p>
            </div>
            <div className={styles.exampleDialogContent}>
              {LATEX_EXAMPLES.map((example) => (
                <button
                  key={example.id}
                  className={styles.exampleItem}
                  onClick={() => handleLoadExample(example.id)}
                  disabled={loadingExample !== null}
                >
                  <div className={styles.exampleItemHeader}>
                    <span className={styles.exampleName}>{example.name}</span>
                    <span className={`${styles.exampleTag} ${getExampleTagClass(example.tag)}`}>
                      {example.tag === 'small'
                        ? '小文件'
                        : example.tag === 'large'
                          ? '大文件'
                          : '超大'}
                    </span>
                  </div>
                  <p className={styles.exampleDescription}>{example.description}</p>
                  <span className={styles.exampleSize}>{formatFileSize(example.size)}</span>
                  {loadingExample === example.id && (
                    <span className={styles.exampleLoading}>加载中...</span>
                  )}
                </button>
              ))}
            </div>
            <div className={styles.exampleDialogFooter}>
              <button className={styles.exampleCancelBtn} onClick={closeExampleDialog}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 搜索区域 */}
      {isSearchMode && !isCollapsed && (
        <div className={styles.sidebarSearch}>
          <div className={styles.searchInputWrapper}>
            <Search size={14} className={styles.searchIcon} />
            <input
              ref={searchInputRef}
              type="text"
              className={styles.searchInput}
              placeholder="搜索文档..."
              value={searchQuery}
              onChange={handleSearchInputChange}
              onKeyDown={handleSearchKeyDown}
            />
            {searchQuery && (
              <button className={styles.searchClearBtn} onClick={clearSearch} title="清空">
                <X size={12} />
              </button>
            )}
            {isSearching && <span className={styles.searchLoading} />}
          </div>

          {/* 搜索结果 */}
          {searchQuery && (
            <div className={styles.searchResults}>
              {searchResults.length > 0 ? (
                searchResults.map((result) => (
                  <div
                    key={result.documentId}
                    className={styles.searchResultItem}
                    onClick={() => handleSearchResultSelect(result)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSearchResultSelect(result);
                    }}
                  >
                    <div className={styles.resultTitle}>{result.title || '无标题'}</div>
                    {result.snippet && <Snippet snippet={result.snippet} className={styles.resultSnippet} />}
                    <div className={styles.resultScore}>
                      匹配度: {Math.round(result.score * 100)}%
                    </div>
                  </div>
                ))
              ) : (
                <div className={styles.searchNoResults}>
                  {isSearchInitialized
                    ? `未找到 "${searchQuery}" 的相关文档`
                    : '搜索索引初始化中...'}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 内容区域 */}
      {!isCollapsed && !isSearchMode && (
        <div className={styles.sidebarContent}>
          {/* 加载状态 */}
          {showLoading && (
            <div className={styles.emptyHint}>
              <p>加载中...</p>
            </div>
          )}

          {/* 树形视图 */}
          {showTree && (
            <div className={styles.treeView}>
              {/* 全部文档选项 */}
              <div
                className={`${styles.treeNode} ${styles.allDocuments} ${
                  selectedDocumentId === null && selectedFolderId === null ? styles.selected : ''
                }`}
                onClick={handleShowAllDocuments}
                role="treeitem"
                aria-selected={selectedDocumentId === null && selectedFolderId === null}
                tabIndex={0}
              >
                <File size={14} className={styles.nodeIcon} />
                <span className={styles.nodeName}>全部文档</span>
                <span className={styles.nodeBadge}>{documents.length}</span>
              </div>

              {/* 虚拟化树节点 */}
              <VirtualizedTreeView
                nodes={nodesWithMeta}
                isExpanded={checkIsExpanded}
                isSelected={checkIsSelected}
                onToggleExpand={handleToggleExpand}
                onSelect={handleSelectNode}
                onStartEdit={handleStartEdit}
                onDelete={handleDelete}
                onCreateSubfolder={handleCreateSubfolder}
                onCreateDocument={handleCreateDocumentInFolder}
                scrollToId={selectedDocId}
                getAncestors={getNodeAncestors}
                onMoveNode={handleMoveNode}
              />
            </div>
          )}

          {/* 空状态 */}
          {showEmptyState && (
            <div className={styles.emptyHint}>
              <p>点击上方 + 创建新文档</p>
            </div>
          )}
        </div>
      )}

      {/* 输入对话框 */}
      <InputDialog
        isOpen={inputDialog.isOpen}
        title={inputDialog.title}
        placeholder={inputDialog.placeholder}
        defaultValue={inputDialog.defaultValue}
        onConfirm={inputDialog.onConfirm}
        onCancel={closeInputDialog}
      />

      {/* 确认对话框 */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        isDanger={confirmDialog.isDanger}
        onConfirm={confirmDialog.onConfirm}
        onCancel={closeConfirmDialog}
      />

      {/* 清空数据确认对话框 */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title="清空所有数据"
        message="确定要清空所有数据吗？此操作将删除所有文档和文件夹，且无法恢复。"
        isDanger={true}
        confirmText="确定清空"
        cancelText="取消"
        onConfirm={handleClearAllData}
        onCancel={() => setShowClearConfirm(false)}
      />

      {/* 文件类型选择对话框 */}
      {fileTypeDialog.isOpen && (
        <div className={styles.fileTypeDialogOverlay} onClick={closeFileTypeDialog}>
          <div className={styles.fileTypeDialog} onClick={(e) => e.stopPropagation()}>
            <div className={styles.fileTypeDialogHeader}>
              <h3>选择文档类型</h3>
              <button
                className={styles.fileTypeDialogClose}
                onClick={closeFileTypeDialog}
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>
            <div className={styles.fileTypeDialogContent}>
              {creatableTypes.map((typeConfig) => (
                <button
                  key={typeConfig.id}
                  className={styles.fileTypeOption}
                  onClick={() => handleSelectFileType(typeConfig)}
                >
                  <span className={styles.fileTypeIcon}>
                    {getFileTypeIcon(typeConfig.icon, 24)}
                  </span>
                  <div className={styles.fileTypeInfo}>
                    <span className={styles.fileTypeName}>{typeConfig.name}</span>
                    <span className={styles.fileTypeDesc}>{typeConfig.description}</span>
                    <span className={styles.fileTypeExt}>
                      扩展名: {typeConfig.extensions.join(', ')}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <div className={styles.fileTypeDialogFooter}>
              <span className={styles.fileTypeHint}>
                提示：右键点击新建按钮可快速创建 Markdown 文档
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(WritingSidebar);

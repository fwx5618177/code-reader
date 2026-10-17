// ================================
// RichEditor 组件
// Typora 风格的 Markdown 所见即所得编辑器（原生 ProseMirror）
// - 文档以 Markdown（.txt 为纯文本）存储，输入 Markdown 语法即时渲染
// - 光标进入格式时显示对应标记；公式、代码块点击展开源码
// - 分块：顺层块序列化缓存、视口外块跳过布局、代码高亮接近视口时执行
// - 双向链接 [[ ]] 补全与跳转
//
// 性能优化:
// - 使用 React.memo 防止不必要的重渲染
// - 使用稳定的 ref 避免闭包问题
// - ProseMirror 管理自己的状态 - React 状态变化不影响光标
// ================================

import React, { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import { EditorState, Transaction, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import type { Schema } from 'prosemirror-model';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn, chainCommands, exitCode } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { createEditorPlugins } from '../../lib/editor';
import {
  markdownSchema,
  parseContent,
  serializeContent,
  formatForFileType,
  createLivePreviewPlugin,
  createTableKeymap,
  SlashCommandProvider,
  WikiLinkCompletionProvider,
  extractHeadings,
  findHeadingInDoc,
  parseWikiLinkInner,
  wikiLinkRef,
  wikiLinkRefOf,
  type ContentFormat,
  type WikiLinkParts,
} from '../../lib/markdown';
import { useLinkResolver } from '../../lib/links';
import {
  Bold,
  Italic,
  Code,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  Undo,
  Redo,
  FileCode,
  Minus,
  Eye,
  Edit3,
  Maximize2,
  Minimize2,
  Type,
  AlignCenter,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  Replace,
} from 'lucide-react';
import {
  createAutocompletePlugin,
  EmojiCompletionProvider,
  LaTeXCompletionProvider,
  type CompletionProvider,
} from '../../lib/editor/prosemirror-autocomplete';
import { createCodeBlockView } from './CodeBlockView';
import { createMathInlineView, createMathBlockView } from './MathNodeView';
import { createListItemView } from './ListItemView';
import { createWikiEmbedView } from './WikiEmbedView';
import { DocumentPreview } from './DocumentPreview';
import { LatexEditor } from './LatexEditor';
import { getEditorBridge, type EditorInstance } from '../../lib/plugins/editor-bridge';
import { createBlockKeymap } from '../../lib/editor/block-commands';
import { createBlockHandlePlugin } from '../../lib/editor/block-handle';
import type { PopupMenuClasses } from '../../lib/editor/popup-menu';
import { createSpellcheckPlugin } from '../../lib/spellcheck/prosemirror-plugin';
import { spellcheckService } from '../../services/spellcheckService';
import popupStyles from './EditorPopups.module.scss';
import styles from './RichEditor.module.scss';

// ================================
// Types
// ================================

export type EditorMode = 'edit' | 'preview' | 'split';
export type ViewMode = 'normal' | 'focus' | 'typewriter';

export interface EditorOptions {
  /** 是否参与自研拼写检查（实际启用与否由设置中的「拼写检查」开关决定） */
  spellCheck?: boolean;
  placeholder?: string;
  showWordCount?: boolean;
  showLineNumbers?: boolean;
  defaultCodeLanguage?: string;
  typewriterMode?: boolean;
  focusMode?: boolean;
  showToolbar?: boolean;
  showBorder?: boolean;
  minHeight?: string;
  contentMaxWidth?: string;
  /** 标题支持 */
  showTitle?: boolean;
  title?: string;
  titlePlaceholder?: string;
  onTitleChange?: (title: string) => void;
  /** 标题输入框失焦（提交重命名） */
  onTitleBlur?: () => void;
  /** 代码块选项 */
  darkCodeTheme?: boolean;
  /** 是否启用搜索功能 */
  enableSearch?: boolean;
}

export interface RichEditorProps {
  /** 初始内容（Markdown 或纯文本；旧版 HTML 内容会自动兼容读入） */
  initialContent?: string;
  /** 内容变化：第一个参数为序列化后的存储内容，第二个为纯文本 */
  onChange?: (content: string, text: string) => void;
  /** Editor configuration options */
  options?: EditorOptions;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Additional CSS class name */
  className?: string;
  /** 文件类型（用于确定渲染模式） */
  fileType?: 'markdown' | 'latex' | 'plain';
  /** 文件名（用于推断文件类型） */
  fileName?: string;
  /** 可链接的文档标题（[[ 补全来源） */
  linkTargets?: string[];
  /** 点击双向链接（参数为 目标#标题 形式的引用） */
  onWikiLinkClick?: (target: string) => void;
  /** 滚动到指定标题（每个请求对象只执行一次） */
  revealHeading?: { heading: string } | null;
}

/**
 * Comparison function for React.memo
 * Only re-render when key props change that actually require a re-render
 * Content changes are handled internally by ProseMirror, not by React
 */
function arePropsEqual(prevProps: RichEditorProps, nextProps: RichEditorProps): boolean {
  // Always re-render if initialContent changes (new document loaded)
  if (prevProps.initialContent !== nextProps.initialContent) {
    return false;
  }

  // Re-render if readOnly changes
  if (prevProps.readOnly !== nextProps.readOnly) {
    return false;
  }

  // Re-render if className changes
  if (prevProps.className !== nextProps.className) {
    return false;
  }

  // For options, only check properties that affect rendering
  // NOT title - title is handled by its own input element
  const prevOpts = prevProps.options || {};
  const nextOpts = nextProps.options || {};

  if (prevOpts.showToolbar !== nextOpts.showToolbar) return false;
  if (prevOpts.showBorder !== nextOpts.showBorder) return false;
  if (prevOpts.showWordCount !== nextOpts.showWordCount) return false;
  if (prevOpts.showTitle !== nextOpts.showTitle) return false;
  if (prevOpts.focusMode !== nextOpts.focusMode) return false;
  if (prevOpts.typewriterMode !== nextOpts.typewriterMode) return false;
  if (prevOpts.placeholder !== nextOpts.placeholder) return false;
  if (prevOpts.minHeight !== nextOpts.minHeight) return false;
  if (prevOpts.contentMaxWidth !== nextOpts.contentMaxWidth) return false;
  if (prevOpts.darkCodeTheme !== nextOpts.darkCodeTheme) return false;
  if (prevOpts.spellCheck !== nextOpts.spellCheck) return false;

  // 文件类型变化时需要重新渲染（影响预览模式）
  if (prevProps.fileType !== nextProps.fileType) return false;
  if (prevProps.fileName !== nextProps.fileName) return false;

  // 链接目标与链接点击回调变化频率很低，重渲染以更新 ref
  if (prevProps.linkTargets !== nextProps.linkTargets) return false;
  if (prevProps.onWikiLinkClick !== nextProps.onWikiLinkClick) return false;
  if (prevProps.revealHeading !== nextProps.revealHeading) return false;

  // Note: We DON'T compare onChange, onTitleChange, title, titlePlaceholder, linkTargets, onWikiLinkClick
  // - 回调与链接目标通过 ref 读取最新值
  // - title/onTitleChange are handled by the title input which manages its own state

  return true;
}

// ================================
// Default Options
// ================================

/**
 * 顶层块数量达到该值时启用分块渲染
 * 分块渲染会给每个块加上绘制包含（裁剪溢出的阴影与描边），小文档没有必要付出这个代价
 */
const CHUNKED_RENDERING_MIN_BLOCKS = 150;

/** 块菜单与拼写建议菜单共用的样式 */
const POPUP_MENU_CLASSES: PopupMenuClasses = {
  menu: popupStyles.menu,
  item: popupStyles.menuItem,
  itemActive: popupStyles.menuItemActive,
  itemCurrent: popupStyles.menuItemCurrent,
  heading: popupStyles.menuHeading,
  separator: popupStyles.menuSeparator,
  hint: popupStyles.menuHint,
};

const DEFAULT_OPTIONS: EditorOptions = {
  spellCheck: true,
  placeholder: '开始写作...',
  showWordCount: true,
  showLineNumbers: true,
  defaultCodeLanguage: 'javascript',
  typewriterMode: false,
  focusMode: false,
  showToolbar: true,
  showBorder: false,
  minHeight: '300px',
  contentMaxWidth: '720px',
  showTitle: false,
  title: '',
  titlePlaceholder: '无标题',
  onTitleChange: undefined,
  darkCodeTheme: false,
  enableSearch: true,
};

// ================================
// 搜索匹配信息
// ================================

interface SearchMatch {
  /** 起始位置 */
  start: number;
  /** 结束位置 */
  end: number;
  /** 匹配文本 */
  text: string;
}

// ================================
// Keymap
// ================================

/**
 * 编辑快捷键
 * - ⌘B / ⌘I / ⌘E / ⌘⇧X：粗体、斜体、行内代码、删除线
 * - Shift-Enter：硬换行（Markdown 中以行尾反斜杠表示）
 * - 列表：Enter 拆分，Tab / Shift-Tab 调整缩进
 */
const createKeymap = (schema: Schema) => {
  const { marks, nodes } = schema;
  const insertHardBreak = chainCommands(exitCode, (state, dispatch) => {
    dispatch?.(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView());
    return true;
  });

  return keymap({
    'Mod-b': toggleMark(marks.strong),
    'Mod-i': toggleMark(marks.em),
    'Mod-e': toggleMark(marks.code),
    'Mod-Shift-x': toggleMark(marks.strike),
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
    'Shift-Enter': insertHardBreak,
    Enter: splitListItem(nodes.list_item),
    Tab: sinkListItem(nodes.list_item),
    'Shift-Tab': liftListItem(nodes.list_item),
  });
};

// ================================
// Toolbar Button Component
// ================================

interface ToolbarButtonProps {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  icon,
  title,
  onClick,
  isActive = false,
  disabled = false,
}) => (
  <button
    type="button"
    className={`${styles.toolbarButton} ${isActive ? styles.active : ''} ${disabled ? styles.disabled : ''}`}
    onClick={onClick}
    title={title}
    disabled={disabled}
  >
    {icon}
  </button>
);

const ToolbarDivider: React.FC = () => <div className={styles.toolbarDivider} />;

// ================================
// 搜索面板组件
// ================================

interface SearchPanelProps {
  query: string;
  replacement: string;
  matchCount: number;
  currentIndex: number;
  showReplace: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  onQueryChange: (value: string) => void;
  onReplacementChange: (value: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
  onToggleReplace: () => void;
  onToggleCaseSensitive: () => void;
  onToggleWholeWord: () => void;
  onToggleRegex: () => void;
}

const SearchPanel: React.FC<SearchPanelProps> = ({
  query,
  replacement,
  matchCount,
  currentIndex,
  showReplace,
  caseSensitive,
  wholeWord,
  useRegex,
  onQueryChange,
  onReplacementChange,
  onNext,
  onPrevious,
  onReplace,
  onReplaceAll,
  onClose,
  onToggleReplace,
  onToggleCaseSensitive,
  onToggleWholeWord,
  onToggleRegex,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // 自动聚焦搜索输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 处理键盘事件
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter') {
        if (e.shiftKey) {
          onPrevious();
        } else {
          onNext();
        }
      }
    },
    [onClose, onNext, onPrevious]
  );

  return (
    <div className={styles.searchPanel}>
      {/* 搜索行 */}
      <div className={styles.searchRow}>
        <button
          type="button"
          className={styles.searchToggle}
          onClick={onToggleReplace}
          title={showReplace ? '隐藏替换' : '显示替换'}
        >
          {showReplace ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>

        <div className={styles.searchInputWrapper}>
          <input
            ref={inputRef}
            type="text"
            className={styles.searchInput}
            placeholder="搜索..."
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <span className={styles.searchCount}>
              {matchCount > 0 ? `${currentIndex + 1}/${matchCount}` : '无结果'}
            </span>
          )}
        </div>

        {/* 搜索选项 */}
        <div className={styles.searchOptions}>
          <button
            type="button"
            className={`${styles.searchOption} ${caseSensitive ? styles.active : ''}`}
            onClick={onToggleCaseSensitive}
            title="区分大小写"
          >
            Aa
          </button>
          <button
            type="button"
            className={`${styles.searchOption} ${wholeWord ? styles.active : ''}`}
            onClick={onToggleWholeWord}
            title="全词匹配"
          >
            Ab
          </button>
          <button
            type="button"
            className={`${styles.searchOption} ${useRegex ? styles.active : ''}`}
            onClick={onToggleRegex}
            title="使用正则表达式"
          >
            .*
          </button>
        </div>

        {/* 导航按钮 */}
        <button
          type="button"
          className={styles.searchNavBtn}
          onClick={onPrevious}
          disabled={matchCount === 0}
          title="上一个 (Shift+Enter)"
        >
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          className={styles.searchNavBtn}
          onClick={onNext}
          disabled={matchCount === 0}
          title="下一个 (Enter)"
        >
          <ChevronDown size={14} />
        </button>

        {/* 关闭按钮 */}
        <button
          type="button"
          className={styles.searchCloseBtn}
          onClick={onClose}
          title="关闭 (Esc)"
        >
          <X size={14} />
        </button>
      </div>

      {/* 替换行 */}
      {showReplace && (
        <div className={styles.replaceRow}>
          <div className={styles.replaceInputWrapper}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="替换为..."
              value={replacement}
              onChange={(e) => onReplacementChange(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          <button
            type="button"
            className={styles.replaceBtn}
            onClick={onReplace}
            disabled={matchCount === 0}
            title="替换"
          >
            <Replace size={14} />
          </button>
          <button
            type="button"
            className={styles.replaceAllBtn}
            onClick={onReplaceAll}
            disabled={matchCount === 0}
            title="全部替换"
          >
            全部
          </button>
        </div>
      )}
    </div>
  );
};

// ================================
// Word Count Helper
// ================================

const countWords = (text: string): number => {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = text
    .replace(/[\u4e00-\u9fa5]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
  return chineseChars + englishWords;
};

const countChars = (text: string): number => {
  return text.replace(/\s/g, '').length;
};

// ================================
// Status Bar Component
// ================================

interface StatusBarProps {
  wordCount: number;
  charCount: number;
}

const StatusBar: React.FC<StatusBarProps> = ({ wordCount, charCount }) => (
  <div className={styles.statusBar}>
    <div className={styles.statusLeft}>
      {/* Status display is now handled by parent component */}
    </div>
    <div className={styles.statusRight}>
      <span className={styles.statusItem}>{wordCount} 字</span>
      <span className={styles.statusItem}>{charCount} 字符</span>
    </div>
  </div>
);

// ================================
// RichEditor Component
// ================================

/** 选中文档中的标题并滚动到视口顶部；找不到标题时不做任何事 */
function revealHeadingInView(view: EditorView, heading: string): void {
  const pos = findHeadingInDoc(view.state.doc, heading);
  if (pos === null) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)));
  view.focus();
  (view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** 已执行过的标题定位请求（编辑器重新挂载时不重复滚动） */
const revealedHeadingRequests = new WeakSet<object>();

/**
 * RichEditor Component
 *
 * A pure presentation component for rich text editing.
 * All save logic (auto-save, manual save) is handled by the parent component
 * via the useDocuments hook and AutoSaveManager.
 *
 * This keeps the editor focused on editing concerns only (high cohesion)
 * and delegates persistence to the appropriate layer (low coupling).
 *
 * Code blocks are rendered with CodeMirror for syntax highlighting.
 */
const RichEditorInner: React.FC<RichEditorProps> = ({
  initialContent = '',
  onChange,
  options: userOptions,
  readOnly = false,
  className = '',
  fileType,
  fileName,
  linkTargets,
  onWikiLinkClick,
  revealHeading,
}) => {
  // Use refs for callbacks to avoid closure issues and unnecessary re-renders
  // This is critical for preventing cursor loss during auto-save
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const linkTargetsRef = useRef<string[]>(linkTargets ?? []);
  linkTargetsRef.current = linkTargets ?? [];

  const onWikiLinkClickRef = useRef(onWikiLinkClick);
  onWikiLinkClickRef.current = onWikiLinkClick;

  // 链接解析（嵌入内容与 [[文档# 标题补全）与当前文档标题（嵌入的循环检测）
  const linkResolver = useLinkResolver();
  const linkResolverRef = useRef(linkResolver);
  linkResolverRef.current = linkResolver;
  const documentTitleRef = useRef(userOptions?.title ?? '');
  documentTitleRef.current = userOptions?.title ?? '';
  const embedViewsRef = useRef<ReturnType<typeof createWikiEmbedView> | null>(null);

  // 存储格式：.md 等为 Markdown，.txt 为纯文本
  const format: ContentFormat = formatForFileType(fileType);

  const onTitleChangeRef = useRef(userOptions?.onTitleChange);
  onTitleChangeRef.current = userOptions?.onTitleChange;
  const onTitleBlurRef = useRef(userOptions?.onTitleBlur);
  onTitleBlurRef.current = userOptions?.onTitleBlur;

  // Stable options merge - only re-compute when userOptions object identity changes
  const options = useMemo(() => ({ ...DEFAULT_OPTIONS, ...userOptions }), [userOptions]);

  // ================================
  // Title State Management (Mature Pattern)
  // ================================
  //
  // Problem: When user types in title, the flow is:
  //   1. User types → setLocalTitle → onTitleChange callback
  //   2. Parent updates Redux state → re-renders with new options.title
  //   3. If we sync from options.title, we might lose cursor position
  //
  // Solution: Use "document ID" as the synchronization key, not the title value.
  // - Only sync title from props when document ID changes (new document loaded)
  // - During editing, local state is the source of truth
  // - This is how VS Code, Notion, and other mature editors handle it
  //
  const [localTitle, setLocalTitle] = useState(options.title || '');
  const lastSyncedDocIdRef = useRef<string | null>(null);

  // Get document ID from initialContent hash (stable identifier for the document)
  // We use initialContent as a proxy for document identity since we don't have direct access to ID
  const documentIdRef = useRef<string>(initialContent);

  // Only sync title when a NEW document is loaded (initialContent changes)
  // This prevents title sync during normal editing which causes cursor loss
  useEffect(() => {
    const currentDocId = initialContent;

    // Only sync if this is a different document
    if (lastSyncedDocIdRef.current !== currentDocId) {
      lastSyncedDocIdRef.current = currentDocId;
      documentIdRef.current = currentDocId;
      setLocalTitle(options.title || '');
    }
  }, [initialContent, options.title]);

  // Handle title change - only updates local state and notifies parent
  // Parent's state update will NOT cause localTitle to be overwritten
  // because we only sync on document change (initialContent change)
  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setLocalTitle(newTitle);
    // Notify parent asynchronously to prevent blocking the input
    // Using setTimeout(0) to ensure the local state update completes first
    setTimeout(() => {
      onTitleChangeRef.current?.(newTitle);
    }, 0);
  }, []);

  // Refs
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  // 搜索相关状态
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchReplacement, setSearchReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // 搜索插件 Key（必须保持稳定引用）
  const searchPluginKeyRef = useRef<PluginKey | null>(null);
  if (!searchPluginKeyRef.current) {
    searchPluginKeyRef.current = new PluginKey('search-highlight');
  }
  const searchPluginKey = searchPluginKeyRef.current;

  // State - only UI state, no save state
  const [editorMode, setEditorMode] = useState<EditorMode>('edit');
  const [viewMode, setViewMode] = useState<ViewMode>('normal');
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  /** 当前文档的存储内容（预览面板使用） */
  const [sourceContent, setSourceContent] = useState('');
  /** 大文档启用分块渲染（视口外的块跳过布局） */
  const [chunked, setChunked] = useState(false);

  // 判断是否为 LaTeX 文件（根据文件类型、文件名和内容特征）
  const isTexFile = useMemo(() => {
    // 根据文件类型判断
    if (fileType === 'latex') return true;

    // 根据文件名扩展名判断
    if (fileName) {
      const ext = fileName.toLowerCase();
      if (ext.endsWith('.tex') || ext.endsWith('.latex') || ext.endsWith('.ltx')) {
        return true;
      }
    }

    // 根据内容特征判断（检测 LaTeX 特有的命令）
    if (initialContent) {
      const latexPatterns = [
        /\\documentclass\s*[{[]/,
        /\\begin\s*\{document\}/,
        /\\usepackage\s*[{[]/,
        /\\section\s*\{/,
        /\\maketitle/,
      ];

      for (const pattern of latexPatterns) {
        if (pattern.test(initialContent)) {
          return true;
        }
      }
    }

    return false;
  }, [fileType, fileName, initialContent]);

  // Initialize ProseMirror
  // 注意：LaTeX 文件的渲染在 JSX 返回部分处理，不在这里提前返回
  useEffect(() => {
    if (!editorContainerRef.current || editorViewRef.current) return;

    const schema = markdownSchema;
    const isMarkdown = format === 'markdown';

    // 解析初始内容（旧版 HTML 内容兼容读入，下次保存时转为 Markdown）
    const doc = parseContent(initialContent, format);

    // 创建搜索高亮插件
    const searchHighlightPlugin = new Plugin({
      key: searchPluginKey,
      state: {
        init(): DecorationSet {
          return DecorationSet.empty;
        },
        apply(tr, decorations): DecorationSet {
          // 检查是否有搜索装饰更新
          const meta = tr.getMeta(searchPluginKey);
          if (meta?.decorations !== undefined) {
            return meta.decorations;
          }
          // 文档变化时映射装饰位置
          if (tr.docChanged) {
            return decorations.map(tr.mapping, tr.doc);
          }
          return decorations;
        },
      },
      props: {
        decorations(state) {
          return this.getState(state);
        },
      },
    });

    // 补全：Markdown 文档支持斜杠命令与 [[ 双向链接；纯文本只保留 Emoji
    const providers: CompletionProvider[] = [new EmojiCompletionProvider()];
    if (isMarkdown) {
      providers.unshift(
        new SlashCommandProvider(schema),
        new WikiLinkCompletionProvider(
          schema,
          () => linkTargetsRef.current,
          (target) => {
            if (target) return linkResolverRef.current?.headings(target) ?? [];
            // [[#… 补全当前文档的标题
            const current = editorViewRef.current;
            return current ? extractHeadings(serializeContent(current.state.doc, format)) : [];
          }
        ),
        new LaTeXCompletionProvider()
      );
    }
    const autocompletePlugin = createAutocompletePlugin({
      providers,
      maxResults: 10,
      minTriggerLength: 0,
      debounceMs: 80,
      container: editorContainerRef.current,
    });

    // 点击双向链接：[[#标题]] 在当前文档内跳转，其余交给上层打开
    const openWikiRef = (editorView: EditorView, ref: string) => {
      const parts = parseWikiLinkInner(ref);
      if (parts && !parts.target && parts.heading) revealHeadingInView(editorView, parts.heading);
      else onWikiLinkClickRef.current?.(ref);
    };
    const wikiLinkClickPlugin = new Plugin({
      props: {
        handleClickOn(editorView, _pos, node, _nodePos, event) {
          if (node.type === schema.nodes.wiki_link) {
            const { target, heading } = node.attrs as WikiLinkParts;
            event.preventDefault();
            openWikiRef(editorView, wikiLinkRef(target, heading));
            return true;
          }
          if (node.type !== schema.nodes.wiki_embed) return false;
          // 点击嵌入的标题或其中的链接时跳转，点击正文则选中嵌入
          const link = (event.target as HTMLElement).closest<HTMLElement>('[data-wiki-target]');
          if (!link) return false;
          event.preventDefault();
          openWikiRef(editorView, wikiLinkRefOf(link));
          return true;
        },
      },
    });

    // 块级嵌入：渲染时读取最新的链接解析与当前文档（![[#标题]] 指向当前文档）
    const embedViews = createWikiEmbedView((editorView) => ({
      resolveEmbed: linkResolverRef.current?.resolveEmbed,
      self: {
        kind: 'note',
        title: documentTitleRef.current,
        content: serializeContent(editorView.state.doc, format),
        format,
      },
    }));
    embedViewsRef.current = embedViews;

    // 插件顺序：输入规则与块级回车 → 表格/列表/格式快捷键 → 基础快捷键 → 历史与光标
    const plugins: Plugin[] = [
      ...(isMarkdown ? createEditorPlugins(schema) : []),
      ...(isMarkdown ? [createTableKeymap(schema), createBlockKeymap()] : []),
      createKeymap(schema),
      keymap(baseKeymap),
      history(),
      dropCursor(),
      gapCursor(),
      searchHighlightPlugin,
      autocompletePlugin,
      wikiLinkClickPlugin,
    ];
    if (isMarkdown) {
      plugins.push(
        createLivePreviewPlugin(schema),
        createBlockHandlePlugin({
          handleClass: popupStyles.blockHandle,
          handleVisibleClass: popupStyles.blockHandleVisible,
          menuClasses: POPUP_MENU_CLASSES,
        })
      );
    }
    if (options.spellCheck) {
      plugins.push(
        createSpellcheckPlugin({
          checker: spellcheckService,
          errorClass: popupStyles.spellError,
          menuClasses: POPUP_MENU_CLASSES,
        })
      );
    }

    const state = EditorState.create({ doc, plugins });

    // 最近一次通知父组件的内容，避免重复通知
    let lastNotified = serializeContent(doc, format);

    const view = new EditorView(editorContainerRef.current, {
      state,
      editable: () => !readOnly && editorMode !== 'preview',
      nodeViews: {
        code_block: createCodeBlockView({
          defaultLanguage: options.defaultCodeLanguage,
          darkTheme: options.darkCodeTheme,
          lineNumbers: options.showLineNumbers,
        }),
        math_inline: createMathInlineView(),
        math_block: createMathBlockView(),
        list_item: createListItemView(),
        wiki_embed: embedViews.nodeView,
      },
      dispatchTransaction(transaction: Transaction) {
        const newState = view.state.apply(transaction);
        view.updateState(newState);
        if (!transaction.docChanged) return;

        // 分块序列化：只有被修改的顶层块会重新序列化
        const content = serializeContent(newState.doc, format);
        if (content === lastNotified) return;
        lastNotified = content;

        const text = newState.doc.textContent;
        setSourceContent(content);
        setWordCount(countWords(text));
        setCharCount(countChars(text));
        setChunked(newState.doc.childCount >= CHUNKED_RENDERING_MIN_BLOCKS);
        onChangeRef.current?.(content, text);
      },
      attributes: {
        class: styles.prosemirror,
        // 拼写检查由自研插件负责，关闭浏览器自带检查
        spellcheck: 'false',
      },
    });

    editorViewRef.current = view;

    // 注册编辑器到 EditorBridge，使插件系统可以访问（内容为 Markdown / 纯文本）
    const editorInstance: EditorInstance = {
      getContent(): string {
        return editorViewRef.current ? serializeContent(editorViewRef.current.state.doc, format) : '';
      },
      setContent(content: string): void {
        const current = editorViewRef.current;
        if (!current) return;
        const newDoc = parseContent(content, format);
        current.dispatch(current.state.tr.replaceWith(0, current.state.doc.content.size, newDoc.content));
      },
      getSelection(): string {
        if (!editorViewRef.current) return '';
        const { from, to } = editorViewRef.current.state.selection;
        return editorViewRef.current.state.doc.textBetween(from, to);
      },
      replaceSelection(text: string): void {
        if (!editorViewRef.current) return;
        const { from, to } = editorViewRef.current.state.selection;
        const tr = editorViewRef.current.state.tr.replaceWith(from, to, schema.text(text));
        editorViewRef.current.dispatch(tr);
      },
      insertText(text: string, position?: number): void {
        if (!editorViewRef.current) return;
        const pos = position ?? editorViewRef.current.state.selection.from;
        const tr = editorViewRef.current.state.tr.insertText(text, pos);
        editorViewRef.current.dispatch(tr);
      },
      getCursorPosition(): { line: number; column: number } {
        // 行号按顶层块计数，列号为块内文本偏移
        if (!editorViewRef.current) return { line: 1, column: 1 };
        const { $from } = editorViewRef.current.state.selection;
        return { line: $from.index(0) + 1, column: $from.parentOffset + 1 };
      },
      setCursorPosition(line: number, column: number): void {
        const current = editorViewRef.current;
        if (!current) return;
        const doc = current.state.doc;
        const blockIndex = Math.min(Math.max(line - 1, 0), doc.childCount - 1);
        let pos = 0;
        for (let i = 0; i < blockIndex; i++) pos += doc.child(i).nodeSize;
        const target = Math.min(pos + column, pos + doc.child(blockIndex).nodeSize - 1);
        current.dispatch(
          current.state.tr.setSelection(TextSelection.near(doc.resolve(Math.max(0, target))))
        );
      },
      focus(): void {
        editorViewRef.current?.focus();
      },
      blur(): void {
        editorViewRef.current?.dom.blur();
      },
    };

    const bridge = getEditorBridge();
    const editorDisposable = bridge.registerEditor(editorInstance);

    // 初始化预览内容与计数
    setSourceContent(lastNotified);
    const text = doc.textContent;
    setWordCount(countWords(text));
    setCharCount(countChars(text));
    setChunked(doc.childCount >= CHUNKED_RENDERING_MIN_BLOCKS);

    // Cleanup
    return () => {
      editorDisposable.dispose();
      view.destroy();
      editorViewRef.current = null;
      embedViewsRef.current = null;
    };
  }, []);

  // 条目列表更新后，被嵌入的内容可能已变化
  useEffect(() => {
    embedViewsRef.current?.refresh();
  }, [linkResolver]);

  // 通过 [[文档#标题]] 打开时滚动到标题（等待首次布局完成）
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || !revealHeading || revealedHeadingRequests.has(revealHeading)) return;
    const frame = requestAnimationFrame(() => {
      revealedHeadingRequests.add(revealHeading);
      revealHeadingInView(view, revealHeading.heading);
    });
    return () => cancelAnimationFrame(frame);
  }, [revealHeading]);

  // Update editable state when mode changes
  useEffect(() => {
    if (editorViewRef.current) {
      editorViewRef.current.setProps({
        editable: () => !readOnly && editorMode !== 'preview',
      });
    }
  }, [readOnly, editorMode]);

  // ================================
  // Toolbar Actions
  // ================================

  const runCommand = useCallback(
    (cmd: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean) => {
      if (editorViewRef.current) {
        const view = editorViewRef.current;
        cmd(view.state, view.dispatch);
        view.focus();
      }
    },
    []
  );

  const toggleBold = useCallback(
    () => runCommand(toggleMark(markdownSchema.marks.strong)),
    [runCommand]
  );

  const toggleItalic = useCallback(
    () => runCommand(toggleMark(markdownSchema.marks.em)),
    [runCommand]
  );

  const toggleCode = useCallback(
    () => runCommand(toggleMark(markdownSchema.marks.code)),
    [runCommand]
  );

  const setHeading = useCallback(
    (level: number) => runCommand(setBlockType(markdownSchema.nodes.heading, { level })),
    [runCommand]
  );

  const toggleBlockquote = useCallback(
    () => runCommand(wrapIn(markdownSchema.nodes.blockquote)),
    [runCommand]
  );

  const insertCodeBlock = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;
    const codeBlock = markdownSchema.nodes.code_block.create({
      language: options.defaultCodeLanguage,
    });
    view.dispatch(view.state.tr.replaceSelectionWith(codeBlock));
    view.focus();
  }, [options.defaultCodeLanguage]);

  const insertHorizontalRule = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch(view.state.tr.replaceSelectionWith(markdownSchema.nodes.horizontal_rule.create()));
    view.focus();
  }, []);

  const handleUndo = useCallback(() => runCommand(undo), [runCommand]);
  const handleRedo = useCallback(() => runCommand(redo), [runCommand]);

  // Check if mark is active
  const isMarkActive = useCallback((markType: string): boolean => {
    if (!editorViewRef.current) return false;
    const mark = markdownSchema.marks[markType];
    if (!mark) return false;

    const { state } = editorViewRef.current;
    const { from, $from, to, empty } = state.selection;

    if (empty) {
      return !!mark.isInSet(state.storedMarks || $from.marks());
    }

    return state.doc.rangeHasMark(from, to, mark);
  }, []);

  // ================================
  // 搜索功能
  // ================================

  // 从编辑器获取当前纯文本内容
  const getEditorTextContent = useCallback((): string => {
    if (!editorViewRef.current) return '';
    return editorViewRef.current.state.doc.textContent;
  }, []);

  // 执行搜索
  const performSearch = useCallback(
    (query: string) => {
      if (!query.trim()) {
        setSearchMatches([]);
        setCurrentMatchIndex(0);
        return;
      }

      const content = getEditorTextContent();
      const matches: SearchMatch[] = [];

      try {
        let pattern: RegExp;

        if (useRegex) {
          pattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
        } else {
          // 转义正则特殊字符
          let escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (wholeWord) {
            escapedQuery = `\\b${escapedQuery}\\b`;
          }
          pattern = new RegExp(escapedQuery, caseSensitive ? 'g' : 'gi');
        }

        let match;
        while ((match = pattern.exec(content)) !== null) {
          matches.push({
            start: match.index,
            end: match.index + match[0].length,
            text: match[0],
          });
          // 防止零宽匹配导致的无限循环
          if (match[0].length === 0) {
            pattern.lastIndex++;
          }
        }
      } catch {
        // 正则表达式无效，忽略错误
      }

      setSearchMatches(matches);
      setCurrentMatchIndex(matches.length > 0 ? 0 : -1);
    },
    [caseSensitive, wholeWord, useRegex, getEditorTextContent]
  );

  // 更新搜索高亮装饰
  const updateSearchDecorations = useCallback(() => {
    if (!editorViewRef.current) return;

    const view = editorViewRef.current;
    const decorations: Decoration[] = [];

    // 计算文本位置到文档位置的映射
    // ProseMirror 文档位置包含节点边界，需要遍历文档计算
    let textOffset = 0;
    const positionMap: Array<{
      textStart: number;
      textEnd: number;
      docStart: number;
      docEnd: number;
    }> = [];

    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        positionMap.push({
          textStart: textOffset,
          textEnd: textOffset + node.text.length,
          docStart: pos,
          docEnd: pos + node.text.length,
        });
        textOffset += node.text.length;
      }
      return true;
    });

    // 将文本位置转换为文档位置
    const textPosToDocPos = (textPos: number): number => {
      for (const range of positionMap) {
        if (textPos >= range.textStart && textPos <= range.textEnd) {
          return range.docStart + (textPos - range.textStart);
        }
      }
      return textPos + 1; // 回退到简单偏移
    };

    // 为每个匹配创建装饰
    searchMatches.forEach((match, index) => {
      const from = textPosToDocPos(match.start);
      const to = textPosToDocPos(match.end);
      const isActive = index === currentMatchIndex;

      decorations.push(
        Decoration.inline(from, to, {
          class: isActive ? 'search-highlight search-highlight-active' : 'search-highlight',
        })
      );
    });

    // 创建装饰集
    const decorationSet = DecorationSet.create(view.state.doc, decorations);

    // 应用装饰到编辑器
    // 使用 setMeta 触发搜索插件更新
    const tr = view.state.tr.setMeta(searchPluginKey, { decorations: decorationSet });
    view.dispatch(tr);
  }, [searchMatches, currentMatchIndex, searchPluginKey]);

  // 搜索匹配变化时更新高亮
  useEffect(() => {
    if (isSearchOpen) {
      updateSearchDecorations();
    }
  }, [searchMatches, currentMatchIndex, isSearchOpen, updateSearchDecorations]);

  // 滚动到当前匹配位置
  const scrollToCurrentMatch = useCallback(() => {
    if (!editorViewRef.current || searchMatches.length === 0 || currentMatchIndex < 0) return;

    const view = editorViewRef.current;
    const match = searchMatches[currentMatchIndex];

    // 计算文档位置并滚动
    let textOffset = 0;
    let targetPos = match.start + 1;

    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        if (match.start >= textOffset && match.start < textOffset + node.text.length) {
          targetPos = pos + (match.start - textOffset);
          return false;
        }
        textOffset += node.text.length;
      }
      return true;
    });

    // 滚动到位置
    const coords = view.coordsAtPos(targetPos);
    if (coords) {
      const container = editorViewRef.current.dom.closest(`.${styles.editorMain}`);
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const scrollTop =
          container.scrollTop + (coords.top - containerRect.top) - containerRect.height / 2;
        container.scrollTo({ top: scrollTop, behavior: 'smooth' });
      }
    }
  }, [searchMatches, currentMatchIndex]);

  // 搜索查询变化时执行搜索
  useEffect(() => {
    performSearch(searchQuery);
  }, [searchQuery, performSearch]);

  // 跳转到下一个匹配
  const goToNextMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
    setCurrentMatchIndex(nextIndex);
    // 延迟滚动以确保状态更新
    setTimeout(() => scrollToCurrentMatch(), 50);
  }, [searchMatches, currentMatchIndex, scrollToCurrentMatch]);

  // 跳转到上一个匹配
  const goToPreviousMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const prevIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(prevIndex);
    // 延迟滚动以确保状态更新
    setTimeout(() => scrollToCurrentMatch(), 50);
  }, [searchMatches, currentMatchIndex, scrollToCurrentMatch]);

  // 替换当前匹配
  const replaceCurrentMatch = useCallback(() => {
    if (searchMatches.length === 0 || currentMatchIndex < 0) return;
    if (!editorViewRef.current) return;

    const match = searchMatches[currentMatchIndex];
    const view = editorViewRef.current;
    const { state, dispatch } = view;

    // 创建事务来替换文本
    const tr = state.tr.replaceWith(
      match.start + 1, // ProseMirror 位置从 1 开始
      match.end + 1,
      state.schema.text(searchReplacement)
    );

    dispatch(tr);
    view.focus();

    // 重新搜索
    setTimeout(() => performSearch(searchQuery), 0);
  }, [searchMatches, currentMatchIndex, searchReplacement, searchQuery, performSearch]);

  // 替换所有匹配
  const replaceAllMatches = useCallback(() => {
    if (searchMatches.length === 0) return;
    if (!editorViewRef.current) return;

    const view = editorViewRef.current;
    const { state, dispatch } = view;

    // 从后往前替换，避免位置偏移
    let tr = state.tr;
    const sortedMatches = [...searchMatches].sort((a, b) => b.start - a.start);

    for (const match of sortedMatches) {
      tr = tr.replaceWith(match.start + 1, match.end + 1, state.schema.text(searchReplacement));
    }

    dispatch(tr);
    view.focus();

    // 清空搜索结果
    setSearchMatches([]);
    setCurrentMatchIndex(-1);
  }, [searchMatches, searchReplacement]);

  // 打开搜索面板
  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
  }, []);

  // 关闭搜索面板
  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
    setSearchMatches([]);
    setCurrentMatchIndex(-1);

    // 清除搜索高亮装饰
    if (editorViewRef.current) {
      const view = editorViewRef.current;
      const tr = view.state.tr.setMeta(searchPluginKey, {
        decorations: DecorationSet.empty,
      });
      view.dispatch(tr);
    }
  }, [searchPluginKey]);

  // 切换搜索面板
  const toggleSearch = useCallback(() => {
    if (isSearchOpen) {
      closeSearch();
    } else {
      openSearch();
    }
  }, [isSearchOpen, openSearch, closeSearch]);

  // 键盘快捷键
  useEffect(() => {
    if (!options.enableSearch) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + F: 打开搜索
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        openSearch();
      }
      // Cmd/Ctrl + H: 打开替换
      if ((e.metaKey || e.ctrlKey) && e.key === 'h') {
        e.preventDefault();
        openSearch();
        setShowReplace(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [options.enableSearch, openSearch]);

  // Build class names
  const editorClassName = useMemo(() => {
    const classes = [styles.richEditor, className];
    classes.push(styles[`mode${editorMode.charAt(0).toUpperCase()}${editorMode.slice(1)}`]);
    if (viewMode === 'typewriter') classes.push(styles.typewriterMode);
    if (viewMode === 'focus') classes.push(styles.focusMode);
    if (readOnly) classes.push(styles.readOnly);
    if (options.showBorder) classes.push(styles.withBorder);
    if (chunked) classes.push(styles.chunkedRendering);
    return classes.filter(Boolean).join(' ');
  }, [className, editorMode, viewMode, readOnly, options.showBorder, chunked]);

  return (
    <div
      className={editorClassName}
      style={
        {
          '--editor-min-height': options.minHeight,
          '--editor-content-max-width': options.contentMaxWidth,
        } as React.CSSProperties
      }
    >
      {/* Title Input - uses local state to prevent cursor loss */}
      {options.showTitle && (
        <div className={styles.titleContainer}>
          <input
            type="text"
            className={styles.titleInput}
            value={localTitle}
            placeholder={options.titlePlaceholder || '无标题'}
            onChange={handleTitleChange}
            onBlur={() => onTitleBlurRef.current?.()}
            readOnly={readOnly}
          />
        </div>
      )}

      {/* Toolbar */}
      {options.showToolbar && !readOnly && (
        <div className={styles.toolbar}>
          {/* Text Formatting */}
          <div className={styles.toolbarGroup}>
            <ToolbarButton
              icon={<Bold size={16} />}
              title="加粗 (⌘B)"
              onClick={toggleBold}
              isActive={isMarkActive('strong')}
            />
            <ToolbarButton
              icon={<Italic size={16} />}
              title="斜体 (⌘I)"
              onClick={toggleItalic}
              isActive={isMarkActive('em')}
            />
            <ToolbarButton
              icon={<Code size={16} />}
              title="行内代码 (⌘E)"
              onClick={toggleCode}
              isActive={isMarkActive('code')}
            />
          </div>

          <ToolbarDivider />

          {/* Headings */}
          <div className={styles.toolbarGroup}>
            <ToolbarButton
              icon={<Heading1 size={16} />}
              title="一级标题"
              onClick={() => setHeading(1)}
            />
            <ToolbarButton
              icon={<Heading2 size={16} />}
              title="二级标题"
              onClick={() => setHeading(2)}
            />
            <ToolbarButton
              icon={<Heading3 size={16} />}
              title="三级标题"
              onClick={() => setHeading(3)}
            />
          </div>

          <ToolbarDivider />

          {/* Blocks */}
          <div className={styles.toolbarGroup}>
            <ToolbarButton icon={<Quote size={16} />} title="引用" onClick={toggleBlockquote} />
            <ToolbarButton icon={<FileCode size={16} />} title="代码块" onClick={insertCodeBlock} />
            <ToolbarButton
              icon={<Minus size={16} />}
              title="分割线"
              onClick={insertHorizontalRule}
            />
          </div>

          <ToolbarDivider />

          {/* History */}
          <div className={styles.toolbarGroup}>
            <ToolbarButton icon={<Undo size={16} />} title="撤销 (⌘Z)" onClick={handleUndo} />
            <ToolbarButton icon={<Redo size={16} />} title="重做 (⌘⇧Z)" onClick={handleRedo} />
          </div>

          <ToolbarDivider />

          {/* 搜索按钮 */}
          {options.enableSearch && (
            <div className={styles.toolbarGroup}>
              <ToolbarButton
                icon={<Search size={16} />}
                title="搜索 (⌘F)"
                onClick={toggleSearch}
                isActive={isSearchOpen}
              />
            </div>
          )}

          {/* Spacer */}
          <div className={styles.toolbarSpacer} />

          {/* View Mode Toggle */}
          <div className={styles.toolbarGroup}>
            <ToolbarButton
              icon={<Type size={16} />}
              title="打字机模式"
              onClick={() => setViewMode(viewMode === 'typewriter' ? 'normal' : 'typewriter')}
              isActive={viewMode === 'typewriter'}
            />
            <ToolbarButton
              icon={<AlignCenter size={16} />}
              title="专注模式"
              onClick={() => setViewMode(viewMode === 'focus' ? 'normal' : 'focus')}
              isActive={viewMode === 'focus'}
            />
          </div>

          <ToolbarDivider />

          {/* Editor Mode Toggle */}
          <div className={styles.toolbarGroup}>
            <ToolbarButton
              icon={<Edit3 size={16} />}
              title="编辑模式"
              onClick={() => setEditorMode('edit')}
              isActive={editorMode === 'edit'}
            />
            <ToolbarButton
              icon={<Eye size={16} />}
              title="预览模式"
              onClick={() => setEditorMode('preview')}
              isActive={editorMode === 'preview'}
            />
            <ToolbarButton
              icon={editorMode === 'split' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              title="分屏模式"
              onClick={() => setEditorMode(editorMode === 'split' ? 'edit' : 'split')}
              isActive={editorMode === 'split'}
            />
          </div>
        </div>
      )}

      {/* 搜索面板 */}
      {isSearchOpen && options.enableSearch && (
        <SearchPanel
          query={searchQuery}
          replacement={searchReplacement}
          matchCount={searchMatches.length}
          currentIndex={currentMatchIndex}
          showReplace={showReplace}
          caseSensitive={caseSensitive}
          wholeWord={wholeWord}
          useRegex={useRegex}
          onQueryChange={setSearchQuery}
          onReplacementChange={setSearchReplacement}
          onNext={goToNextMatch}
          onPrevious={goToPreviousMatch}
          onReplace={replaceCurrentMatch}
          onReplaceAll={replaceAllMatches}
          onClose={closeSearch}
          onToggleReplace={() => setShowReplace(!showReplace)}
          onToggleCaseSensitive={() => setCaseSensitive(!caseSensitive)}
          onToggleWholeWord={() => setWholeWord(!wholeWord)}
          onToggleRegex={() => setUseRegex(!useRegex)}
        />
      )}

      {/* Editor Content */}
      <div className={styles.content}>
        {/* LaTeX 文件使用专门的编辑器 */}
        {isTexFile ? (
          <LatexEditor
            initialContent={initialContent}
            onChange={(content) => {
              onChangeRef.current?.(content, content);
            }}
            readOnly={readOnly}
            showLineNumbers={true}
          />
        ) : (
          <>
            {/* Main Editor */}
            <div
              className={`${styles.editorMain} ${editorMode === 'preview' ? styles.hidden : ''}`}
            >
              <div ref={editorContainerRef} className={styles.editorContainer} />
            </div>

            {/* Preview (for split/preview mode) */}
            {(editorMode === 'split' || editorMode === 'preview') && (
              <div className={styles.preview}>
                <DocumentPreview
                  content={sourceContent}
                  format={format}
                  title={options.title}
                  onWikiLinkClick={onWikiLinkClick}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* 状态栏 - 仅显示字数/字符数，保存状态在父组件中 */}
      {options.showWordCount && <StatusBar wordCount={wordCount} charCount={charCount} />}
    </div>
  );
};

/**
 * RichEditor 组件，使用 React.memo 优化
 *
 * 使用自定义比较函数防止不必要的重渲染：
 * - ProseMirror 管理自己的状态和光标位置
 * - React 状态更新（来自自动保存）不会导致光标丢失
 * - 仅在结构性 props 变化时重渲染（initialContent、readOnly 等）
 *
 * 这遵循与 VS Code 编辑器相同的模式 - 编辑器管理其内部状态，
 * React 仅处理容器生命周期。
 */
const RichEditor = memo(RichEditorInner, arePropsEqual);

export default RichEditor;

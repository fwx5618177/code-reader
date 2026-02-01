// ================================
// FileTree 组件
// 使用 CSS Modules 实现样式
// ================================

import React, { useState, useMemo } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File,
  FileCode,
  FileJson,
  FileText,
  FileType,
  Image,
  Music,
  Video,
  Archive,
  Settings,
} from 'lucide-react';
import styles from './FileTree.module.scss';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface FileTreeProps {
  files: FileNode[];
  onFileSelect: (path: string) => void;
  selectedFile?: string | null;
}

interface FileTreeItemProps {
  node: FileNode;
  onFileSelect: (path: string) => void;
  selectedFile?: string | null;
  depth?: number;
}

// 获取文件扩展名
const getFileExtension = (filename: string): string => {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()?.toLowerCase() || '' : '';
};

// 获取文件类型对应的图标
const getFileIcon = (filename: string) => {
  const ext = getFileExtension(filename);
  const iconProps = { size: 16, strokeWidth: 1.75 };

  // 编程语言
  const codeExtensions = [
    'js',
    'jsx',
    'ts',
    'tsx',
    'vue',
    'svelte',
    'py',
    'rb',
    'go',
    'rs',
    'java',
    'kt',
    'swift',
    'c',
    'cpp',
    'h',
    'cs',
    'php',
    'scala',
    'clj',
    'ex',
    'erl',
    'hs',
    'lua',
    'r',
    'sh',
    'bash',
    'zsh',
    'ps1',
    'sql',
  ];

  // 配置/数据文件
  const jsonExtensions = ['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env'];

  // 文本/文档文件
  const textExtensions = ['md', 'mdx', 'txt', 'rtf', 'doc', 'docx', 'pdf'];

  // 样式文件
  const styleExtensions = ['css', 'scss', 'sass', 'less', 'styl'];

  // 图片文件
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'];

  // 音频文件
  const audioExtensions = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'];

  // 视频文件
  const videoExtensions = ['mp4', 'webm', 'mov', 'avi', 'mkv'];

  // 压缩文件
  const archiveExtensions = ['zip', 'tar', 'gz', 'rar', '7z', 'bz2'];

  // 配置文件名
  const configFiles = [
    'package.json',
    'tsconfig.json',
    'vite.config.ts',
    'webpack.config.js',
    '.eslintrc',
    '.prettierrc',
    '.gitignore',
    'dockerfile',
    'docker-compose.yml',
  ];

  const lowerFilename = filename.toLowerCase();

  if (configFiles.some((cf) => lowerFilename.includes(cf.toLowerCase()))) {
    return <Settings {...iconProps} className={`${styles.fileIcon} ${styles.config}`} />;
  }

  if (codeExtensions.includes(ext)) {
    return <FileCode {...iconProps} className={`${styles.fileIcon} ${styles.code}`} />;
  }

  if (jsonExtensions.includes(ext)) {
    return <FileJson {...iconProps} className={`${styles.fileIcon} ${styles.json}`} />;
  }

  if (textExtensions.includes(ext)) {
    return <FileText {...iconProps} className={`${styles.fileIcon} ${styles.text}`} />;
  }

  if (styleExtensions.includes(ext)) {
    return <FileType {...iconProps} className={`${styles.fileIcon} ${styles.style}`} />;
  }

  if (imageExtensions.includes(ext)) {
    return <Image {...iconProps} className={`${styles.fileIcon} ${styles.image}`} />;
  }

  if (audioExtensions.includes(ext)) {
    return <Music {...iconProps} className={`${styles.fileIcon} ${styles.audio}`} />;
  }

  if (videoExtensions.includes(ext)) {
    return <Video {...iconProps} className={`${styles.fileIcon} ${styles.video}`} />;
  }

  if (archiveExtensions.includes(ext)) {
    return <Archive {...iconProps} className={`${styles.fileIcon} ${styles.archive}`} />;
  }

  return <File {...iconProps} className={`${styles.fileIcon} ${styles.default}`} />;
};

// 排序文件：文件夹优先，然后按字母排序
const sortFiles = (files: FileNode[]): FileNode[] => {
  return [...files].sort((a, b) => {
    if (a.type === b.type) {
      return a.name.localeCompare(b.name);
    }
    return a.type === 'directory' ? -1 : 1;
  });
};

const FileTreeItem: React.FC<FileTreeItemProps> = ({
  node,
  onFileSelect,
  selectedFile,
  depth = 0,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const isSelected = selectedFile === node.path;
  const isDirectory = node.type === 'directory';

  const handleClick = () => {
    if (isDirectory) {
      setIsExpanded(!isExpanded);
    } else {
      onFileSelect(node.path);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
    if (isDirectory) {
      if (e.key === 'ArrowRight' && !isExpanded) {
        setIsExpanded(true);
      }
      if (e.key === 'ArrowLeft' && isExpanded) {
        setIsExpanded(false);
      }
    }
  };

  const sortedChildren = useMemo(() => {
    return node.children ? sortFiles(node.children) : [];
  }, [node.children]);

  const indentStyle = {
    paddingLeft: `${depth * 12 + 8}px`,
  };

  // 构建行的类名
  const rowClassNames = [
    styles.itemRow,
    isDirectory ? styles.directory : styles.file,
    isSelected ? styles.selected : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={styles.fileTreeItem}
      role="treeitem"
      aria-expanded={isDirectory ? isExpanded : undefined}
    >
      <div
        className={rowClassNames}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={indentStyle}
        tabIndex={0}
        role="button"
      >
        {/* 展开/折叠指示器 */}
        <span className={`${styles.expandIcon} ${isExpanded ? styles.expanded : ''}`}>
          {isDirectory ? (
            isExpanded ? (
              <ChevronDown size={14} strokeWidth={2} />
            ) : (
              <ChevronRight size={14} strokeWidth={2} />
            )
          ) : (
            <span className={styles.expandSpacer} />
          )}
        </span>

        {/* 文件/文件夹图标 */}
        <span className={styles.itemIcon}>
          {isDirectory ? (
            isExpanded ? (
              <FolderOpen
                size={16}
                strokeWidth={1.75}
                className={`${styles.folderIcon} ${styles.open}`}
              />
            ) : (
              <Folder size={16} strokeWidth={1.75} className={styles.folderIcon} />
            )
          ) : (
            getFileIcon(node.name)
          )}
        </span>

        {/* 文件/文件夹名称 */}
        <span className={styles.itemName} title={node.name}>
          {node.name}
        </span>
      </div>

      {/* 子项（如果是展开的文件夹） */}
      {isDirectory && isExpanded && sortedChildren.length > 0 && (
        <div className={styles.itemChildren} role="group">
          {sortedChildren.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              onFileSelect={onFileSelect}
              selectedFile={selectedFile}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FileTree: React.FC<FileTreeProps> = ({ files, onFileSelect, selectedFile }) => {
  const sortedFiles = useMemo(() => sortFiles(files), [files]);

  if (files.length === 0) {
    return (
      <div className={`${styles.fileTree} ${styles.empty}`}>
        <div className={styles.emptyState}>
          <Folder size={32} strokeWidth={1.5} />
          <p>暂无文件</p>
          <span className={styles.hint}>打开一个文件夹开始浏览</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.fileTree} role="tree" aria-label="文件树">
      {sortedFiles.map((file) => (
        <FileTreeItem
          key={file.path}
          node={file}
          onFileSelect={onFileSelect}
          selectedFile={selectedFile}
        />
      ))}
    </div>
  );
};

export default FileTree;

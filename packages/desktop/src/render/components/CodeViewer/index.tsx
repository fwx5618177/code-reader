// ================================
// CodeViewer 组件
// 使用 CSS Modules 实现样式
// ================================

import React, { useEffect, useState, useMemo, useRef } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-sql';
import { FileCode, Copy, Check, Maximize2, Minimize2 } from 'lucide-react';
import styles from './CodeViewer.module.scss';

interface CodeViewerProps {
  filePath: string | null;
}

// 将文件扩展名映射到 Prism 语言标识符
const getLanguage = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    mjs: 'javascript',
    cjs: 'javascript',

    // Web
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'scss',
    less: 'css',

    // 数据格式
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'markup',
    toml: 'toml',

    // 文档
    md: 'markdown',
    mdx: 'markdown',

    // 编程语言
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    cs: 'csharp',
    php: 'php',

    // Shell
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'bash',
    ps1: 'powershell',

    // 数据库
    sql: 'sql',

    // 配置
    env: 'bash',
    gitignore: 'git',
    dockerignore: 'docker',
  };

  return languageMap[ext] || 'plaintext';
};

// 从路径获取文件名
const getFileName = (path: string): string => {
  return path.split('/').pop() || path;
};

const CodeViewer: React.FC<CodeViewerProps> = ({ filePath }) => {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const loadContent = async () => {
      if (!filePath) {
        setContent('');
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const fileContent = (await window.electron.ipcRenderer.invoke(
          'read-file',
          filePath
        )) as string;
        setContent(fileContent);
      } catch (err) {
        console.error('读取文件错误:', err);
        setError('无法读取文件内容');
        setContent('');
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, [filePath]);

  // 应用语法高亮
  useEffect(() => {
    if (codeRef.current && content && filePath) {
      Prism.highlightElement(codeRef.current);
    }
  }, [content, filePath]);

  // 将内容分割为行以显示行号
  const lines = useMemo(() => {
    return content.split('\n');
  }, [content]);

  // 获取当前文件的语言
  const language = useMemo(() => {
    return filePath ? getLanguage(filePath) : 'plaintext';
  }, [filePath]);

  // 复制到剪贴板
  const handleCopy = async () => {
    if (content) {
      try {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('复制失败:', err);
      }
    }
  };

  // 切换全屏
  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  // 空状态
  if (!filePath) {
    return (
      <div className={`${styles.codeViewer} ${styles.empty}`}>
        <div className={styles.emptyState}>
          <FileCode size={48} strokeWidth={1} />
          <h3>选择文件查看</h3>
          <p>从左侧文件树中选择一个文件来查看其内容</p>
        </div>
      </div>
    );
  }

  // 加载状态
  if (loading) {
    return (
      <div className={`${styles.codeViewer} ${styles.loading}`}>
        <div className={styles.loadingSpinner}>
          <div className={styles.spinner}></div>
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className={`${styles.codeViewer} ${styles.error}`}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>⚠️</span>
          <h3>读取失败</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const fileName = getFileName(filePath);

  // 构建容器类名
  const containerClassName = [styles.codeViewer, isFullscreen ? styles.fullscreen : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClassName}>
      {/* 头部 */}
      <div className={styles.codeHeader}>
        <div className={styles.fileInfo}>
          <FileCode size={14} strokeWidth={1.75} className={styles.fileIcon} />
          <span className={styles.fileName} title={filePath}>
            {fileName}
          </span>
          <span className={styles.fileLanguage}>{language}</span>
        </div>

        <div className={styles.headerActions}>
          <span className={styles.lineCount}>{lines.length} 行</span>

          <button
            className={styles.actionButton}
            onClick={handleCopy}
            title={copied ? '已复制' : '复制代码'}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>

          <button
            className={styles.actionButton}
            onClick={toggleFullscreen}
            title={isFullscreen ? '退出全屏' : '全屏'}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* 代码内容 */}
      <div className={styles.codeContent}>
        {/* 行号 */}
        <div className={styles.lineNumbers} aria-hidden="true">
          {lines.map((_, index) => (
            <span key={index} className={styles.lineNumber}>
              {index + 1}
            </span>
          ))}
        </div>

        {/* 代码 */}
        <pre className={styles.codePre}>
          <code ref={codeRef} className={`language-${language}`}>
            {content}
          </code>
        </pre>
      </div>

      {/* 文件路径（页脚） */}
      <div className={styles.codeFooter}>
        <span className={styles.filePath} title={filePath}>
          {filePath}
        </span>
      </div>
    </div>
  );
};

export default CodeViewer;

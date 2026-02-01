// ================================
// WelcomeGuide 组件
// 首次使用用户的欢迎引导模态框
// 可关闭且不再显示
// ================================

import React, { useEffect, useCallback } from 'react';
import { X, PenTool, Keyboard, Focus, Save, FileText, HelpCircle } from 'lucide-react';
import styles from './WelcomeGuide.module.scss';

// ================================
// 本地存储键
// ================================

const STORAGE_KEY = 'welcomeGuideDismissed';

// ================================
// 属性接口
// ================================

export interface WelcomeGuideProps {
  /** 模态框是否打开 */
  isOpen: boolean;
  /** 关闭时的回调 */
  onClose: () => void;
  /** 是否持久化关闭状态（默认: true） */
  persistDismissal?: boolean;
}

// ================================
// 辅助函数：检查引导是否已关闭
// ================================

export function wasWelcomeGuideDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

// ================================
// 辅助函数：标记引导为已关闭
// ================================

export function dismissWelcomeGuide(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    console.warn('[WelcomeGuide] 无法持久化关闭状态');
  }
}

// ================================
// 辅助函数：重置引导关闭状态
// ================================

export function resetWelcomeGuide(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    console.warn('[WelcomeGuide] 无法重置关闭状态');
  }
}

// ================================
// 组件
// ================================

const WelcomeGuide: React.FC<WelcomeGuideProps> = ({
  isOpen,
  onClose,
  persistDismissal = true,
}) => {
  // 处理关闭并可选持久化
  const handleClose = useCallback(() => {
    if (persistDismissal) {
      dismissWelcomeGuide();
    }
    onClose();
  }, [onClose, persistDismissal]);

  // 处理 ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  // 未打开时不渲染
  if (!isOpen) return null;

  return (
    <div className={styles.welcomeGuideOverlay} onClick={handleClose}>
      <div className={styles.welcomeGuideModal} onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className={styles.welcomeGuideHeader}>
          <div className={styles.headerTitle}>
            <PenTool size={20} />
            <h2>欢迎使用写作模式</h2>
          </div>
          <button className={styles.closeButton} onClick={handleClose} title="关闭 (Esc)">
            <X size={18} />
          </button>
        </div>

        {/* 内容区 */}
        <div className={styles.welcomeGuideContent}>
          <p className={styles.intro}>这是一个简洁、专注的写作环境，帮助你捕捉灵感、整理思绪。</p>

          {/* 快速开始 */}
          <section className={styles.guideSection}>
            <h3>
              <FileText size={16} />
              快速开始
            </h3>
            <ul className={styles.guideList}>
              <li>
                <kbd>⌘N</kbd>
                <span>新建文档</span>
              </li>
              <li>
                <kbd>⌘S</kbd>
                <span>保存文档</span>
              </li>
              <li>
                <kbd>⌘⇧F</kbd>
                <span>进入专注模式</span>
              </li>
            </ul>
          </section>

          {/* Markdown 快捷输入 */}
          <section className={styles.guideSection}>
            <h3>
              <Keyboard size={16} />
              Markdown 快捷输入
            </h3>
            <div className={styles.shortcutGrid}>
              <div className={styles.shortcutItem}>
                <code># </code>
                <span>一级标题</span>
              </div>
              <div className={styles.shortcutItem}>
                <code>## </code>
                <span>二级标题</span>
              </div>
              <div className={styles.shortcutItem}>
                <code>### </code>
                <span>三级标题</span>
              </div>
              <div className={styles.shortcutItem}>
                <code>&gt; </code>
                <span>引用块</span>
              </div>
              <div className={styles.shortcutItem}>
                <code>- </code>
                <span>无序列表</span>
              </div>
              <div className={styles.shortcutItem}>
                <code>1. </code>
                <span>有序列表</span>
              </div>
              <div className={styles.shortcutItem}>
                <code>```</code>
                <span>代码块</span>
              </div>
              <div className={styles.shortcutItem}>
                <code>---</code>
                <span>分割线</span>
              </div>
            </div>
          </section>

          {/* 编辑快捷键 */}
          <section className={styles.guideSection}>
            <h3>
              <Save size={16} />
              编辑快捷键
            </h3>
            <ul className={`${styles.guideList} ${styles.guideListCompact}`}>
              <li>
                <kbd>⌘B</kbd>
                <span>加粗</span>
              </li>
              <li>
                <kbd>⌘I</kbd>
                <span>斜体</span>
              </li>
              <li>
                <kbd>⌘E</kbd>
                <span>行内代码</span>
              </li>
              <li>
                <kbd>⌘K</kbd>
                <span>插入链接</span>
              </li>
              <li>
                <kbd>⌘Z</kbd>
                <span>撤销</span>
              </li>
              <li>
                <kbd>⌘⇧Z</kbd>
                <span>重做</span>
              </li>
            </ul>
          </section>

          {/* 专注模式 */}
          <section className={`${styles.guideSection} ${styles.guideSectionHighlight}`}>
            <h3>
              <Focus size={16} />
              专注模式
            </h3>
            <p>
              按 <kbd>⌘⇧F</kbd> 进入专注模式，界面会自动隐藏所有干扰元素，让你沉浸在写作中。 按{' '}
              <kbd>Esc</kbd> 键随时退出。
            </p>
          </section>
        </div>

        {/* 底部 */}
        <div className={styles.welcomeGuideFooter}>
          <div className={styles.footerHint}>
            <HelpCircle size={14} />
            <span>
              随时点击侧边栏的 <strong>?</strong> 按钮查看此指南
            </span>
          </div>
          <button className={styles.startButton} onClick={handleClose}>
            开始写作
          </button>
        </div>
      </div>
    </div>
  );
};

export default WelcomeGuide;

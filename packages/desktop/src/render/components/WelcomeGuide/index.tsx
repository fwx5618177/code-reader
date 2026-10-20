// ================================
// “从这里开始”卡片
// 第一次启动时显示一次（任意模式），之后从写作侧栏的 ?、菜单栏 帮助 → 从这里开始 打开。
// 只讲三种模式、前四步与常用快捷键，细节交给完整的使用指南
// ================================

import React, { useCallback, useEffect } from 'react';
import { BookOpen, Compass, Inbox, PenLine, BookOpenText, X } from 'lucide-react';
import styles from './WelcomeGuide.module.scss';

const STORAGE_KEY = 'welcomeGuideDismissed';

export interface WelcomeGuideProps {
  isOpen: boolean;
  onClose: () => void;
  /** 打开完整的使用指南 */
  onOpenGuide: () => void;
}

export function wasWelcomeGuideDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function dismissWelcomeGuide(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    console.warn('[WelcomeGuide] 无法记住已关闭');
  }
}

const MODES = [
  {
    icon: <Inbox size={18} />,
    name: '知识库',
    key: '⌘1',
    text: '随手收集想法、录音、图片、文件、网页，AI 自动写摘要、打标签、找关联',
  },
  {
    icon: <PenLine size={18} />,
    name: '写作',
    key: '⌘2',
    text: '写 Markdown 笔记（输入即渲染）与 LaTeX 论文，[[ ]] 链接其他笔记',
  },
  { icon: <BookOpenText size={18} />, name: '阅读', key: '⌘3', text: '读网页剪藏、PDF、EPUB，高亮后摘录回知识库' },
];

const FIRST_STEPS: React.ReactNode[] = [
  <>
    按 <kbd>⌘,</kbd> 打开设置 → <strong>AI 服务</strong>，添加服务商并填写 API Key（可以跳过，只是没有自动整理）
  </>,
  <>
    按 <kbd>⌘N</kbd> 写下一句话，<kbd>⌘↵</kbd> 保存：它进入知识库，几秒后出现摘要和标签
  </>,
  <>
    按 <kbd>⌘2</kbd> 到写作，在左侧新建 Markdown 文档，输入 <code># 标题</code>、<code>**粗体**</code>、
    <code>$E=mc^2$</code>
  </>,
  <>
    在文档里输入 <code>[[</code> 选择另一篇笔记，右侧“参考”面板会出现双向链接
  </>,
];

const SHORTCUTS: Array<[string, string]> = [
  ['⌘N', '快速记录'],
  ['⌘P', '全局搜索'],
  ['⌘1 / 2 / 3', '切换模式'],
  ['⌘,', '设置'],
  ['⌃空格', '补全'],
  ['⌘/', '编辑 ↔ 预览'],
  ['⌘⇧P', '命令面板'],
  ['F1', '使用指南'],
];

const WelcomeGuide: React.FC<WelcomeGuideProps> = ({ isOpen, onClose, onOpenGuide }) => {
  const handleClose = useCallback(() => {
    dismissWelcomeGuide();
    onClose();
  }, [onClose]);

  const handleOpenGuide = useCallback(() => {
    handleClose();
    onOpenGuide();
  }, [handleClose, onOpenGuide]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  return (
    <div className={styles.welcomeGuideOverlay} onClick={handleClose}>
      <div
        className={styles.welcomeGuideModal}
        role="dialog"
        aria-modal="true"
        aria-label="从这里开始"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.welcomeGuideHeader}>
          <div className={styles.headerTitle}>
            <Compass size={20} />
            <h2>从这里开始</h2>
          </div>
          <button className={styles.closeButton} onClick={handleClose} title="关闭 (Esc)" aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className={styles.welcomeGuideContent}>
          <p className={styles.intro}>一个应用里有三种模式，用顶部标签或快捷键切换。所有内容只保存在本机。</p>

          <section className={styles.guideSection}>
            <ul className={styles.modeList}>
              {MODES.map((mode) => (
                <li key={mode.name} className={styles.modeItem}>
                  <span className={styles.modeIcon}>{mode.icon}</span>
                  <div>
                    <div className={styles.modeName}>
                      {mode.name} <kbd className={styles.kbd}>{mode.key}</kbd>
                    </div>
                    <p className={styles.guideSectionText}>{mode.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.guideSection}>
            <h3 className={styles.guideSectionTitle}>前四步</h3>
            <ol className={styles.stepList}>
              {FIRST_STEPS.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          </section>

          <section className={styles.guideSection}>
            <h3 className={styles.guideSectionTitle}>常用快捷键（Windows / Linux 上 ⌘ 换成 Ctrl）</h3>
            <ul className={styles.shortcutGrid}>
              {SHORTCUTS.map(([key, text]) => (
                <li key={key} className={styles.shortcutItem}>
                  <kbd className={styles.shortcutCode}>{key}</kbd>
                  <span className={styles.shortcutText}>{text}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className={styles.welcomeGuideFooter}>
          <button className={styles.secondaryButton} onClick={handleOpenGuide}>
            <BookOpen size={14} />
            打开完整使用指南
          </button>
          <button className={styles.startButton} onClick={handleClose}>
            开始使用
          </button>
        </div>
      </div>
    </div>
  );
};

export default WelcomeGuide;

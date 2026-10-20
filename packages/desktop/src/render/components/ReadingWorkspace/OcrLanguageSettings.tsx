// ================================
// 文字识别语言设置（阅读排版面板中的分区，仅 PDF 显示）
// 列出资源目录中实际存在的语言数据，点击切换是否参与识别；可导入 .traineddata 语言数据，删除导入的语言
// ================================

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Plus, X } from 'lucide-react';
import { ipcErrorMessage } from '../../lib/utils/ipc-error';
import { ocrLanguageService } from '../../services/ocrLanguageService';
import styles from './OcrLanguageSettings.module.scss';

/** 常见语言代码的显示名称；其余直接显示代码 */
const LANGUAGE_NAMES: Record<string, string> = {
  chi_sim: '简体中文',
  chi_tra: '繁体中文',
  eng: '英文',
  jpn: '日文',
  kor: '韩文',
  fra: '法文',
  deu: '德文',
  spa: '西班牙文',
  rus: '俄文',
};

export const OcrLanguageSettings: React.FC = () => {
  const { languages, active, loaded, error } = useSyncExternalStore(
    ocrLanguageService.subscribe,
    ocrLanguageService.getSnapshot
  );
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    void ocrLanguageService.refresh();
  }, []);

  const perform = (action: () => Promise<void>) => {
    setActionError(null);
    action().catch((cause) => setActionError(ipcErrorMessage(cause)));
  };

  return (
    <section className={styles.section} aria-label="文字识别语言">
      <div className={styles.header}>
        <span className={styles.title}>文字识别语言</span>
        <button
          className={styles.importButton}
          onClick={() => perform(() => ocrLanguageService.importLanguages())}
          title="导入 Tesseract 语言数据（.traineddata）"
        >
          <Plus size={12} />
          导入
        </button>
      </div>

      {loaded && languages.length === 0 && !error && (
        <div className={styles.hint}>没有可用的语言数据，请导入 .traineddata 文件</div>
      )}
      <div className={styles.languages}>
        {languages.map(({ code, source }) => {
          const selected = active.includes(code);
          return (
            <span key={code} className={`${styles.language} ${selected ? styles.languageActive : ''}`}>
              <button
                className={styles.languageToggle}
                aria-pressed={selected}
                onClick={() => ocrLanguageService.toggle(code)}
                title={code}
              >
                {LANGUAGE_NAMES[code] ?? code}
              </button>
              {source === 'user' && (
                <button
                  className={styles.languageRemove}
                  onClick={() => perform(() => ocrLanguageService.removeLanguage(code))}
                  aria-label={`删除语言 ${code}`}
                  title="删除导入的语言数据"
                >
                  <X size={10} />
                </button>
              )}
            </span>
          );
        })}
      </div>
      <div className={styles.hint}>用于识别扫描版 PDF，可同时选择多种语言</div>
      {(actionError ?? error) && <div className={styles.error}>{actionError ?? error}</div>}
    </section>
  );
};

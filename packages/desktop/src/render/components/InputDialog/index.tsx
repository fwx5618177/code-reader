// ================================
// InputDialog 组件
// 自定义对话框，替代 Electron 不支持的 prompt()
// ================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import styles from './InputDialog.module.scss';

// ================================
// 属性接口
// ================================

export interface InputDialogProps {
  /** 对话框是否打开 */
  isOpen: boolean;
  /** 对话框标题 */
  title: string;
  /** 输入框占位符 */
  placeholder?: string;
  /** 初始输入值 */
  defaultValue?: string;
  /** 确认按钮文本 */
  confirmText?: string;
  /** 取消按钮文本 */
  cancelText?: string;
  /** 是否为危险操作（红色确认按钮） */
  isDanger?: boolean;
  /** 确认时的回调，返回输入值 */
  onConfirm: (value: string) => void;
  /** 取消时的回调 */
  onCancel: () => void;
}

// ================================
// 组件
// ================================

const InputDialog: React.FC<InputDialogProps> = ({
  isOpen,
  title,
  placeholder = '',
  defaultValue = '',
  confirmText = '确定',
  cancelText = '取消',
  isDanger = false,
  onConfirm,
  onCancel,
}) => {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // 对话框打开时重置值并聚焦
  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      // 延迟聚焦以确保对话框已渲染
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, defaultValue]);

  // 处理键盘事件
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && value.trim()) {
        onConfirm(value.trim());
      } else if (e.key === 'Escape') {
        onCancel();
      }
    },
    [value, onConfirm, onCancel]
  );

  // 处理确认
  const handleConfirm = useCallback(() => {
    if (value.trim()) {
      onConfirm(value.trim());
    }
  }, [value, onConfirm]);

  // 未打开时不渲染
  if (!isOpen) return null;

  const confirmButtonClasses = [styles.confirmButton, isDanger ? styles.danger : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className={styles.header}>
          <h3>{title}</h3>
          <button className={styles.closeButton} onClick={onCancel} title="关闭">
            <X size={16} />
          </button>
        </div>

        {/* 内容区域 */}
        <div className={styles.content}>
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
          />
        </div>

        {/* 底部 */}
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onCancel}>
            {cancelText}
          </button>
          <button className={confirmButtonClasses} onClick={handleConfirm} disabled={!value.trim()}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InputDialog;

// ================================
// ConfirmDialog 组件
// 替代 Electron 不支持的 confirm()
// ================================

export interface ConfirmDialogProps {
  /** 对话框是否打开 */
  isOpen: boolean;
  /** 对话框标题 */
  title: string;
  /** 对话框消息 */
  message: string;
  /** 确认按钮文本 */
  confirmText?: string;
  /** 取消按钮文本 */
  cancelText?: string;
  /** 是否为危险操作（红色确认按钮） */
  isDanger?: boolean;
  /** 确认时的回调 */
  onConfirm: () => void;
  /** 取消时的回调 */
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  isDanger = false,
  onConfirm,
  onCancel,
}) => {
  // 处理键盘事件
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        onConfirm();
      } else if (e.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onConfirm, onCancel]);

  // 未打开时不渲染
  if (!isOpen) return null;

  const modalClasses = [styles.modal, styles.confirmModal].join(' ');
  const confirmButtonClasses = [styles.confirmButton, isDanger ? styles.danger : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={modalClasses} onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className={styles.header}>
          <h3>{title}</h3>
          <button className={styles.closeButton} onClick={onCancel} title="关闭">
            <X size={16} />
          </button>
        </div>

        {/* 内容区域 */}
        <div className={styles.content}>
          <p className={styles.confirmMessage}>{message}</p>
        </div>

        {/* 底部 */}
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onCancel}>
            {cancelText}
          </button>
          <button className={confirmButtonClasses} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

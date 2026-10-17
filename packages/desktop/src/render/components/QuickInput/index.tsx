// ================================
// QuickInput 组件
// 快速输入弹窗，支持多种输入类型
// ================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Type,
  Mic,
  Image,
  FileUp,
  Link,
  Send,
  Loader,
  Paperclip,
  Tag,
  ChevronDown,
  StopCircle,
  Trash2,
} from 'lucide-react';
import type { QuickInputType } from '../../types/knowledge';
import { isSingleWebUrl } from '../../lib/knowledge/web-clip';
import { useRecordingWaveform } from './useRecordingWaveform';
import styles from './QuickInput.module.scss';

interface QuickInputProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: QuickInputData) => void;
  /** 打开时的初始输入模式 */
  initialMode?: QuickInputType;
}

export interface QuickInputData {
  type: QuickInputType;
  content: string;
  title?: string;
  tags?: string[];
  folderId?: string;
  attachments?: File[];
  sourceUrl?: string;
}

interface InputTypeOption {
  type: QuickInputType;
  icon: React.ReactNode;
  label: string;
  placeholder: string;
}

const inputTypes: InputTypeOption[] = [
  {
    type: 'text',
    icon: <Type size={16} />,
    label: '文字',
    placeholder: '快速记录想法...',
  },
  {
    type: 'voice',
    icon: <Mic size={16} />,
    label: '语音',
    placeholder: '点击开始录音...',
  },
  {
    type: 'image',
    icon: <Image size={16} />,
    label: '图片',
    placeholder: '拖拽或粘贴图片...',
  },
  {
    type: 'file',
    icon: <FileUp size={16} />,
    label: '文件',
    placeholder: '拖拽文件到这里...',
  },
  {
    type: 'url',
    icon: <Link size={16} />,
    label: '网址',
    placeholder: '粘贴网址，自动剪藏...',
  },
];

const QuickInput: React.FC<QuickInputProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialMode = 'text',
}) => {
  const [inputType, setInputType] = useState<QuickInputType>(initialMode);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  /** 录音中的麦克风音频流，用于绘制实时波形；停止录音后为 null */
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showTagInput, setShowTagInput] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const waveformRef = useRef<HTMLCanvasElement>(null);

  useRecordingWaveform(waveformRef, recordingStream);

  // 设置初始模式并在打开时聚焦
  useEffect(() => {
    if (isOpen) {
      setInputType(initialMode);

      // 如果以语音模式打开，自动开始录音
      if (initialMode === 'voice') {
        setTimeout(() => {
          startRecording();
        }, 100);
      } else if (textareaRef.current) {
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 100);
      }
    }
  }, [isOpen, initialMode]);

  // 清理录音定时器
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, []);

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
      // Cmd/Ctrl + Enter 提交
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && isOpen) {
        handleSubmit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, content]);

  // 重置表单
  const resetForm = useCallback(() => {
    setContent('');
    setTitle('');
    setTags([]);
    setTagInput('');
    setAttachments([]);
    setIsRecording(false);
    setRecordingStream(null);
    setRecordingTime(0);
    setShowTagInput(false);
  }, []);

  // 关闭时重置
  useEffect(() => {
    if (!isOpen) {
      resetForm();
    }
  }, [isOpen, resetForm]);

  // 提交
  const handleSubmit = async () => {
    if (!content.trim() && attachments.length === 0) return;

    setIsSubmitting(true);

    try {
      const data: QuickInputData = {
        type: inputType,
        content: content.trim(),
        title: title.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        sourceUrl: inputType === 'url' ? content.trim() : undefined,
      };

      await onSubmit(data);
      resetForm();
      onClose();
    } catch (error) {
      console.error('提交失败:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 开始录音
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioFile = new File([audioBlob], `recording-${Date.now()}.webm`, {
          type: 'audio/webm',
        });
        setAttachments((prev) => [...prev, audioFile]);
        setContent(`[语音录音 ${formatTime(recordingTime)}]`);

        // 停止所有音轨
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingStream(stream);

      // 开始计时
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('开始录音失败:', error);
      alert('无法访问麦克风，请检查权限设置');
    }
  };

  // 停止录音
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setRecordingStream(null);

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  // 格式化时间
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 处理文件选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      setAttachments((prev) => [...prev, ...Array.from(files)]);
    }
  };

  // 处理拖放
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files) {
      setAttachments((prev) => [...prev, ...Array.from(files)]);
    }
  };

  // 处理粘贴：图片切换到图片模式；在空的文字输入中粘贴单个网址时切换到网址模式（保存时自动剪藏）
  const handlePaste = (e: React.ClipboardEvent) => {
    if (inputType === 'text' && !content.trim() && isSingleWebUrl(e.clipboardData.getData('text/plain'))) {
      setInputType('url');
    }
    const items = Array.from(e.clipboardData.items);
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          setAttachments((prev) => [...prev, file]);
          if (inputType !== 'image') {
            setInputType('image');
          }
        }
      }
    }
  };

  // 移除附件
  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // 添加标签
  const handleAddTag = () => {
    const trimmedTag = tagInput.trim();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags((prev) => [...prev, trimmedTag]);
      setTagInput('');
    }
  };

  // 移除标签
  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  // 标签输入回车
  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  if (!isOpen) return null;

  const currentType = inputTypes.find((t) => t.type === inputType)!;

  // 组合标签头部类名
  const tagsHeaderClassName = [styles.tagsHeader, showTagInput ? styles.tagsHeaderRotate : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className={styles.header}>
          <h2>快速输入</h2>
          <button className={styles.closeButton} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* 类型选择器 */}
        <div className={styles.typeSelector}>
          {inputTypes.map((option) => {
            const buttonClassName = [
              styles.typeButton,
              inputType === option.type ? styles.typeButtonActive : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <button
                key={option.type}
                className={buttonClassName}
                onClick={() => setInputType(option.type)}
              >
                {option.icon}
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>

        {/* 内容区域 */}
        <div
          className={styles.contentArea}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onPaste={handlePaste}
        >
          {/* 标题输入框（可选） */}
          <input
            type="text"
            className={styles.titleInput}
            placeholder="标题（可选）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {/* 语音录制 UI */}
          {inputType === 'voice' ? (
            <div className={styles.voiceRecorder}>
              {isRecording ? (
                <>
                  <div className={styles.recordingIndicator}>
                    <span className={styles.pulse} />
                    <span className={styles.time}>{formatTime(recordingTime)}</span>
                  </div>
                  <canvas ref={waveformRef} className={styles.waveform} role="img" aria-label="录音音量" />
                  <button className={styles.stopButton} onClick={stopRecording}>
                    <StopCircle size={24} />
                    <span>停止录音</span>
                  </button>
                </>
              ) : (
                <button className={styles.recordButton} onClick={startRecording}>
                  <Mic size={24} />
                  <span>点击开始录音</span>
                </button>
              )}
            </div>
          ) : (
            /* 文字/网址输入 */
            <textarea
              ref={textareaRef}
              className={styles.contentInput}
              placeholder={currentType.placeholder}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={inputType === 'url' ? 2 : 5}
            />
          )}

          {/* 附件预览 */}
          {attachments.length > 0 && (
            <div className={styles.attachmentsPreview}>
              {attachments.map((file, index) => (
                <div key={index} className={styles.attachmentItem}>
                  <span className={styles.attachmentName}>{file.name}</span>
                  <span className={styles.attachmentSize}>{(file.size / 1024).toFixed(1)} KB</span>
                  <button
                    className={styles.removeAttachment}
                    onClick={() => removeAttachment(index)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 标签 */}
          <div className={styles.tagsSection}>
            <div className={tagsHeaderClassName} onClick={() => setShowTagInput(!showTagInput)}>
              <Tag size={14} />
              <span>标签</span>
              <ChevronDown size={14} />
            </div>

            {showTagInput && (
              <div className={styles.tagsContent}>
                <div className={styles.tagsList}>
                  {tags.map((tag) => (
                    <span key={tag} className={styles.tagItem}>
                      #{tag}
                      <button onClick={() => removeTag(tag)}>
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  className={styles.tagInput}
                  placeholder="输入标签，回车添加"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onBlur={handleAddTag}
                />
              </div>
            )}
          </div>
        </div>

        {/* 底部 */}
        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            <button className={styles.attachButton} onClick={() => fileInputRef.current?.click()}>
              <Paperclip size={16} />
              <span>附件</span>
            </button>
            <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileSelect} />
          </div>

          <div className={styles.footerRight}>
            <span className={styles.hint}>⌘ + Enter 提交</span>
            <button
              className={styles.submitButton}
              onClick={handleSubmit}
              disabled={isSubmitting || (!content.trim() && attachments.length === 0)}
            >
              {isSubmitting ? <Loader size={16} className={styles.spin} /> : <Send size={16} />}
              <span>保存</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickInput;

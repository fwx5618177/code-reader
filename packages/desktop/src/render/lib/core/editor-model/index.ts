// ================================
// Editor Model 模块
// 版本化内容管理，用于成熟的自动保存和协作功能
// 支持 versionId + contentHash 双处理
// 支持撤销/重做
// ================================

// 类型导出
export type {
  VersionedContent,
  ContentSnapshot,
  ContentChangeEvent,
  ContentChangeListener,
  EditorModelConfig,
  IEditorModel,
} from './types';

export {
  createVersionedContent,
  areVersionsEqual,
  hasContentChanged,
  isVersionNewer,
  createContentSnapshot,
} from './types';

// 版本追踪器
export type {
  VersionTrackerConfig,
  VersionSnapshot,
  VersionChangeEvent,
  VersionChangeListener,
} from './version-tracker';

export { VersionTracker, createVersionTracker } from './version-tracker';

// 编辑器模型
export { EditorModel, createEditorModel, createEditorModelFromDocument } from './editor-model';

// 可撤销编辑器模型
export type {
  UndoableEditorModelConfig,
  UndoRedoState,
  UndoRedoResult,
} from './undoable-editor-model';

export {
  UndoableEditorModel,
  createUndoableEditorModel,
  createUndoableEditorModelFromDocument,
} from './undoable-editor-model';

// 编辑器管理器（单例）
export type {
  ManagedEditorInstance,
  EditorManagerConfig,
  CreateEditorOptions,
  AcquireResult,
} from './editor-manager';

export {
  DocumentEditorManager,
  getEditorManager,
  acquireEditor,
  releaseEditor,
  getEditor,
} from './editor-manager';

// React Hooks
export type { UseEditorModelConfig, UseEditorModelReturn } from './useEditorModel';
export { useEditorModel } from './useEditorModel';

export type { UseManagedEditorConfig, UseManagedEditorReturn } from './useManagedEditor';
export { useManagedEditor } from './useManagedEditor';

// ================================
// Save Engine Module
// Pull-based version-aware save engine for mature auto-save
// ================================

// Types
export type {
  SaveResult,
  ISaveStrategy,
  IContentProvider,
  ISaveExecutor,
  SaveEngineState,
  SaveEngineEvent,
  SaveEngineEventListener,
  SaveEngineConfig,
  ISaveEngine,
} from './types';

export { createSuccessResult, createFailedResult, initialSaveEngineState } from './types';

// Strategies
export {
  DebouncedSaveStrategy,
  createDebouncedStrategy,
  createTypingOptimizedStrategy,
  createResponsiveStrategy,
  DEFAULT_DEBOUNCED_CONFIG,
  ImmediateSaveStrategy,
  createImmediateStrategy,
  DEFAULT_IMMEDIATE_CONFIG,
} from './strategies';

export type { DebouncedStrategyConfig, ImmediateStrategyConfig } from './strategies';

// Save Engine
export { SaveEngine, createSaveEngine, createAutoSaveEngine } from './save-engine';

// React Hook
export type { UseSaveEngineConfig, UseSaveEngineReturn } from './useSaveEngine';
export { useSaveEngine } from './useSaveEngine';

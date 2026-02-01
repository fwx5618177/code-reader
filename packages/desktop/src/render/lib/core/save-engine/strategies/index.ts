// ================================
// Save Strategies Module
// Different strategies for scheduling saves
// ================================

// Debounced Strategy (default for auto-save)
export {
  DebouncedSaveStrategy,
  createDebouncedStrategy,
  createTypingOptimizedStrategy,
  createResponsiveStrategy,
  DEFAULT_DEBOUNCED_CONFIG,
} from './debounced';

export type { DebouncedStrategyConfig } from './debounced';

// Immediate Strategy (for manual save)
export {
  ImmediateSaveStrategy,
  createImmediateStrategy,
  DEFAULT_IMMEDIATE_CONFIG,
} from './immediate';

export type { ImmediateStrategyConfig } from './immediate';

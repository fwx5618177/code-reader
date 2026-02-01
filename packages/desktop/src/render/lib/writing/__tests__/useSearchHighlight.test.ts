// ================================
// useSearchHighlight Hook Unit Tests
// Tests for real-time search highlighting functionality
// ================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSearchHighlight } from '../hooks/useSearchHighlight';

// ================================
// Test Suite
// ================================

describe('useSearchHighlight', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ================================
  // Basic Functionality Tests
  // ================================

  describe('Basic Functionality', () => {
    it('should initialize with empty query and no highlights', () => {
      const { result } = renderHook(() => useSearchHighlight('Hello World'));

      expect(result.current.query).toBe('');
      expect(result.current.highlights).toEqual([]);
      expect(result.current.matchCount).toBe(0);
      expect(result.current.activeIndex).toBe(0);
      expect(result.current.isSearching).toBe(false);
    });

    it('should update query when setQuery is called', () => {
      const { result } = renderHook(() => useSearchHighlight('Hello World'));

      act(() => {
        result.current.setQuery('Hello');
      });

      expect(result.current.query).toBe('Hello');
    });

    it('should find matches for simple query', async () => {
      const { result } = renderHook(() =>
        useSearchHighlight('Hello World Hello', { debounceMs: 0 })
      );

      act(() => {
        result.current.setQuery('Hello');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(2);
      expect(result.current.highlights.length).toBe(2);
    });

    it('should return empty highlights for no matches', async () => {
      const { result } = renderHook(() => useSearchHighlight('Hello World', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('xyz');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(0);
      expect(result.current.highlights).toEqual([]);
    });

    it('should clear highlights when query is cleared', async () => {
      const { result } = renderHook(() => useSearchHighlight('Hello World', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('Hello');
      });
      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(1);

      act(() => {
        result.current.clear();
      });

      expect(result.current.query).toBe('');
      expect(result.current.matchCount).toBe(0);
    });
  });

  // ================================
  // Case Sensitivity Tests
  // ================================

  describe('Case Sensitivity', () => {
    it('should be case-insensitive by default', async () => {
      const { result } = renderHook(() =>
        useSearchHighlight('Hello HELLO hello', { debounceMs: 0 })
      );

      act(() => {
        result.current.setQuery('hello');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(3);
    });

    it('should respect caseSensitive option', async () => {
      const { result } = renderHook(() =>
        useSearchHighlight('Hello HELLO hello', {
          caseSensitive: true,
          debounceMs: 0,
        })
      );

      act(() => {
        result.current.setQuery('hello');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(1);
    });
  });

  // ================================
  // Whole Word Matching Tests
  // ================================

  describe('Whole Word Matching', () => {
    it('should match partial words by default', async () => {
      const { result } = renderHook(() =>
        useSearchHighlight('Hello HelloWorld', { debounceMs: 0 })
      );

      act(() => {
        result.current.setQuery('Hello');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(2);
    });

    it('should only match whole words when wholeWord is true', async () => {
      const { result } = renderHook(() =>
        useSearchHighlight('Hello HelloWorld', {
          wholeWord: true,
          debounceMs: 0,
        })
      );

      act(() => {
        result.current.setQuery('Hello');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(1);
    });
  });

  // ================================
  // Regex Support Tests
  // ================================

  describe('Regex Support', () => {
    it('should escape regex special characters by default', async () => {
      const { result } = renderHook(() => useSearchHighlight('a.b a-b a+b', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('a.b');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(1);
    });

    it('should use regex when useRegex is true', async () => {
      const { result } = renderHook(() =>
        useSearchHighlight('a1b a2b a3b abc', {
          useRegex: true,
          debounceMs: 0,
        })
      );

      act(() => {
        result.current.setQuery('a\\db');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(3);
    });

    it('should handle invalid regex gracefully', async () => {
      const { result } = renderHook(() =>
        useSearchHighlight('Hello World', {
          useRegex: true,
          debounceMs: 0,
        })
      );

      act(() => {
        result.current.setQuery('[invalid');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(0);
      expect(result.current.highlights).toEqual([]);
    });
  });

  // ================================
  // Navigation Tests
  // ================================

  describe('Navigation', () => {
    it('should navigate to next match', async () => {
      const { result } = renderHook(() => useSearchHighlight('a a a a', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('a');
      });

      await vi.runAllTimersAsync();

      expect(result.current.activeIndex).toBe(0);

      act(() => {
        result.current.goToNext();
      });

      expect(result.current.activeIndex).toBe(1);

      act(() => {
        result.current.goToNext();
      });

      expect(result.current.activeIndex).toBe(2);
    });

    it('should wrap around when navigating past last match', async () => {
      const { result } = renderHook(() => useSearchHighlight('a a', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('a');
      });

      await vi.runAllTimersAsync();

      act(() => {
        result.current.goToNext();
        result.current.goToNext();
      });

      expect(result.current.activeIndex).toBe(0);
    });

    it('should navigate to previous match', async () => {
      const { result } = renderHook(() => useSearchHighlight('a a a', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('a');
      });

      await vi.runAllTimersAsync();

      act(() => {
        result.current.goToPrevious();
      });

      expect(result.current.activeIndex).toBe(2);
    });

    it('should navigate to specific index', async () => {
      const { result } = renderHook(() => useSearchHighlight('a a a a a', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('a');
      });

      await vi.runAllTimersAsync();

      act(() => {
        result.current.goToIndex(3);
      });

      expect(result.current.activeIndex).toBe(3);
    });

    it('should ignore invalid index', async () => {
      const { result } = renderHook(() => useSearchHighlight('a a', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('a');
      });

      await vi.runAllTimersAsync();

      act(() => {
        result.current.goToIndex(10);
      });

      expect(result.current.activeIndex).toBe(0);
    });
  });

  // ================================
  // isHighlighted Function Tests
  // ================================

  describe('isHighlighted', () => {
    it('should return highlight for position within match', async () => {
      const { result } = renderHook(() => useSearchHighlight('Hello World', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('World');
      });

      await vi.runAllTimersAsync();

      const highlight = result.current.isHighlighted(7);
      expect(highlight).not.toBeNull();
      expect(highlight?.text).toBe('World');
    });

    it('should return null for position outside match', async () => {
      const { result } = renderHook(() => useSearchHighlight('Hello World', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('World');
      });

      await vi.runAllTimersAsync();

      const highlight = result.current.isHighlighted(0);
      expect(highlight).toBeNull();
    });
  });

  // ================================
  // HTML Generation Tests
  // ================================

  describe('getHighlightedHtml', () => {
    it('should return escaped HTML when no matches', async () => {
      const { result } = renderHook(() => useSearchHighlight('<div>Test</div>', { debounceMs: 0 }));

      const html = result.current.getHighlightedHtml('<div>Test</div>');
      expect(html).toBe('&lt;div&gt;Test&lt;/div&gt;');
    });

    it('should wrap matches with mark tags', async () => {
      const { result } = renderHook(() => useSearchHighlight('Hello World', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('World');
      });

      await vi.runAllTimersAsync();

      const html = result.current.getHighlightedHtml('Hello World');
      expect(html).toContain('<mark');
      expect(html).toContain('World');
      expect(html).toContain('search-highlight');
    });

    it('should mark active match differently', async () => {
      const { result } = renderHook(() => useSearchHighlight('a a', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('a');
      });

      await vi.runAllTimersAsync();

      const html = result.current.getHighlightedHtml('a a');
      expect(html).toContain('search-highlight-active');
    });
  });

  // ================================
  // Replace Tests
  // ================================

  describe('Replace Functionality', () => {
    it('should replace active match', async () => {
      const { result } = renderHook(() => useSearchHighlight('Hello World', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('World');
      });

      await vi.runAllTimersAsync();

      const replaced = result.current.replaceActive('Universe');
      expect(replaced).toBe('Hello Universe');
    });

    it('should return null when no active match', async () => {
      const { result } = renderHook(() => useSearchHighlight('Hello World', { debounceMs: 0 }));

      const replaced = result.current.replaceActive('Test');
      expect(replaced).toBeNull();
    });

    it('should replace all matches', async () => {
      const { result } = renderHook(() => useSearchHighlight('a b a b a', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('a');
      });

      await vi.runAllTimersAsync();

      const replaced = result.current.replaceAll('a b a b a', 'X');
      expect(replaced).toBe('X b X b X');
    });
  });

  // ================================
  // Max Matches Tests
  // ================================

  describe('Max Matches', () => {
    it('should respect maxMatches option', async () => {
      const content = 'a '.repeat(100);
      const { result } = renderHook(() =>
        useSearchHighlight(content, {
          maxMatches: 10,
          debounceMs: 0,
        })
      );

      act(() => {
        result.current.setQuery('a');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(10);
    });
  });

  // ================================
  // Highlight Range Tests
  // ================================

  describe('Highlight Ranges', () => {
    it('should have correct start and end positions', async () => {
      const { result } = renderHook(() => useSearchHighlight('Hello World', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('World');
      });

      await vi.runAllTimersAsync();

      expect(result.current.highlights[0].start).toBe(6);
      expect(result.current.highlights[0].end).toBe(11);
    });

    it('should track match index', async () => {
      const { result } = renderHook(() => useSearchHighlight('a b a b a', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('a');
      });

      await vi.runAllTimersAsync();

      expect(result.current.highlights[0].index).toBe(0);
      expect(result.current.highlights[1].index).toBe(1);
      expect(result.current.highlights[2].index).toBe(2);
    });

    it('should mark active highlight correctly', async () => {
      const { result } = renderHook(() => useSearchHighlight('a b a b a', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('a');
      });

      await vi.runAllTimersAsync();

      expect(result.current.highlights[0].isActive).toBe(true);
      expect(result.current.highlights[1].isActive).toBe(false);

      act(() => {
        result.current.goToNext();
      });

      expect(result.current.highlights[0].isActive).toBe(false);
      expect(result.current.highlights[1].isActive).toBe(true);
    });
  });

  // ================================
  // Content Change Tests
  // ================================

  describe('Content Changes', () => {
    it('should re-search when content changes', async () => {
      const { result, rerender } = renderHook(
        ({ content }) => useSearchHighlight(content, { debounceMs: 0 }),
        { initialProps: { content: 'Hello World' } }
      );

      act(() => {
        result.current.setQuery('Hello');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(1);

      rerender({ content: 'Hello Hello Hello' });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(3);
    });
  });

  // ================================
  // Edge Cases
  // ================================

  describe('Edge Cases', () => {
    it('should handle empty content', async () => {
      const { result } = renderHook(() => useSearchHighlight('', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('test');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(0);
    });

    it('should handle empty query', async () => {
      const { result } = renderHook(() => useSearchHighlight('Hello World', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(0);
    });

    it('should handle whitespace-only query', async () => {
      const { result } = renderHook(() => useSearchHighlight('Hello World', { debounceMs: 0 }));

      act(() => {
        result.current.setQuery('   ');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(0);
    });

    it('should handle special characters in content', async () => {
      const { result } = renderHook(() =>
        useSearchHighlight('Price: $100 (discounted)', { debounceMs: 0 })
      );

      act(() => {
        result.current.setQuery('$100');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(1);
    });

    it('should handle unicode characters', async () => {
      const { result } = renderHook(() =>
        useSearchHighlight('你好世界 Hello 你好', { debounceMs: 0 })
      );

      act(() => {
        result.current.setQuery('你好');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(2);
    });

    it('should handle newlines', async () => {
      const { result } = renderHook(() =>
        useSearchHighlight('line1\nline2\nline1', { debounceMs: 0 })
      );

      act(() => {
        result.current.setQuery('line1');
      });

      await vi.runAllTimersAsync();

      expect(result.current.matchCount).toBe(2);
    });
  });
});

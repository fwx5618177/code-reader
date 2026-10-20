import { describe, it, expect } from 'vitest';
import { ScrollSyncLock, SCROLL_OWNER_WINDOW_MS } from '../scroll-sync';

describe('ScrollSyncLock', () => {
  it('用户滚动源码时同步预览，并取得所有权', () => {
    const lock = new ScrollSyncLock();
    expect(lock.decide('source-scroll', 0)).toBe('sync-preview');
    expect(lock.current(10)).toBe('source');
  });

  it('程序设置预览 scrollTop 引起的 scroll 事件不会回推源码', () => {
    const lock = new ScrollSyncLock();
    lock.decide('source-scroll', 0);
    expect(lock.decide('preview-scroll', 16)).toBe('none');
    // 时间窗过期后的孤立预览滚动（重排、滚动锚定）同样忽略
    expect(lock.decide('preview-scroll', 1000)).toBe('none');
  });

  it('只有在预览区用户输入后，预览滚动才同步源码，且持续滚动会延长所有权', () => {
    const lock = new ScrollSyncLock();
    expect(lock.decide('preview-input', 0)).toBe('none');
    expect(lock.decide('preview-scroll', 10)).toBe('sync-source');
    expect(lock.decide('preview-scroll', 10 + SCROLL_OWNER_WINDOW_MS - 1)).toBe('sync-source');
    expect(lock.current(10 + 2 * SCROLL_OWNER_WINDOW_MS - 3)).toBe('preview');
  });

  it('预览持有所有权期间，源码 scroll 事件（来自我们的同步）不会反向驱动预览', () => {
    const lock = new ScrollSyncLock();
    lock.decide('preview-input', 0);
    lock.decide('preview-scroll', 5);
    expect(lock.decide('source-scroll', 20)).toBe('none');
    expect(lock.current(20)).toBe('preview');
  });

  it('预览刷新/测量后只做源码 → 预览；用户正在滚动预览时不打扰', () => {
    const lock = new ScrollSyncLock();
    expect(lock.decide('preview-layout', 0)).toBe('sync-preview');
    lock.decide('source-scroll', 10);
    expect(lock.decide('preview-layout', 20)).toBe('sync-preview');
    // 预览刷新不会取得所有权，也不会产生 sync-source
    expect(lock.current(20)).toBe('source');

    lock.decide('preview-input', 500);
    expect(lock.decide('preview-layout', 510)).toBe('none');
    expect(lock.decide('preview-layout', 500 + SCROLL_OWNER_WINDOW_MS)).toBe('sync-preview');
  });

  it('所有权时间窗过期后，源码滚动重新生效', () => {
    const lock = new ScrollSyncLock();
    lock.decide('preview-input', 0);
    expect(lock.decide('source-scroll', SCROLL_OWNER_WINDOW_MS)).toBe('sync-preview');
  });
});

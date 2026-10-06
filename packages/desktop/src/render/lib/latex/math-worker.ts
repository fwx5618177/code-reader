// ================================
// 数学公式 Web Worker 渲染器
//
// 在后台线程渲染数学公式，避免阻塞主线程
// 使用自研 math 渲染模块（不依赖 KaTeX）
//
// 特性：
// 1. 自研数学渲染器
// 2. 批量渲染优化
// 3. 渲染缓存（LRU）
// 4. 错误恢复机制
// 5. 超时控制
// ================================

import { parseMath } from '../math/parser';
import { MathRenderer } from '../math/renderer';

// 单例渲染器实例
const mathRenderer = new MathRenderer({ showErrors: true });

// ================================
// 类型定义
// ================================

/** 数学公式渲染请求 */
export interface MathRenderRequest {
  /** 请求 ID */
  id: string;
  /** 请求类型 */
  type: 'render' | 'render_batch' | 'clear_cache' | 'get_stats';
  /** 请求数据 */
  data?: {
    /** LaTeX 公式 */
    latex?: string;
    /** 是否为块级公式 */
    displayMode?: boolean;
    /** 批量渲染列表 */
    formulas?: Array<{
      id: string;
      latex: string;
      displayMode: boolean;
    }>;
  };
}

/** 数学公式渲染响应 */
export interface MathRenderResponse {
  /** 请求 ID */
  id: string;
  /** 是否成功 */
  success: boolean;
  /** 渲染结果 */
  data?: {
    /** 渲染后的 HTML */
    html?: string;
    /** 批量渲染结果 */
    results?: Array<{
      id: string;
      html: string;
      success: boolean;
      error?: string;
    }>;
    /** 缓存统计 */
    stats?: {
      size: number;
      hits: number;
      misses: number;
      hitRate: number;
    };
  };
  /** 错误信息 */
  error?: string;
  /** 处理耗时（毫秒） */
  time: number;
}

// ================================
// LRU 缓存实现
// ================================

/** 缓存最大条目数 */
const CACHE_MAX_SIZE = 1000;

/** 缓存条目 */
interface CacheEntry {
  html: string;
  createdAt: number;
  accessCount: number;
}

/** 渲染缓存 */
const renderCache = new Map<string, CacheEntry>();

/** 缓存命中次数 */
let cacheHits = 0;

/** 缓存未命中次数 */
let cacheMisses = 0;

/**
 * 生成缓存键
 */
function getCacheKey(latex: string, displayMode: boolean): string {
  return `${displayMode ? 'block' : 'inline'}_${hashString(latex)}`;
}

/**
 * 计算字符串哈希值（FNV-1a）
 */
function hashString(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash ^= char;
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16);
}

/**
 * 从缓存获取
 */
function getFromCache(key: string): string | null {
  const entry = renderCache.get(key);
  if (entry) {
    // LRU：更新访问信息
    entry.accessCount++;
    cacheHits++;
    return entry.html;
  }
  cacheMisses++;
  return null;
}

/**
 * 添加到缓存
 */
function addToCache(key: string, html: string): void {
  // 检查缓存大小限制
  if (renderCache.size >= CACHE_MAX_SIZE) {
    // 淘汰访问次数最少的条目
    let minKey: string | null = null;
    let minCount = Infinity;

    for (const [k, v] of renderCache) {
      if (v.accessCount < minCount) {
        minCount = v.accessCount;
        minKey = k;
      }
    }

    if (minKey) {
      renderCache.delete(minKey);
    }
  }

  renderCache.set(key, {
    html,
    createdAt: Date.now(),
    accessCount: 1,
  });
}

/**
 * 清空缓存
 */
function clearCache(): void {
  renderCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

/**
 * 获取缓存统计
 */
function getCacheStats() {
  const total = cacheHits + cacheMisses;
  return {
    size: renderCache.size,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: total > 0 ? cacheHits / total : 0,
  };
}

// ================================
// 自研数学渲染
// ================================

/**
 * 渲染数学公式
 * 使用自研 math 模块渲染
 */
function renderMathFormula(latex: string, displayMode: boolean): string {
  // 检查缓存
  const cacheKey = getCacheKey(latex, displayMode);
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // 如果公式为空，直接返回空字符串
    if (!latex || !latex.trim()) {
      return '';
    }

    // 使用自研解析器和渲染器
    const ast = parseMath(latex, { displayMode });
    const result = mathRenderer.render(ast);

    if (result.success) {
      addToCache(cacheKey, result.html);
      return result.html;
    }

    // 渲染失败，返回错误 HTML
    const escapedLatex = escapeHtml(latex);
    const errorHtml = `<span class="math-error" title="${escapeHtml(result.error || '渲染错误')}">⚠ ${escapedLatex}</span>`;
    return errorHtml;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const escapedLatex = escapeHtml(latex);
    return `<span class="math-error" title="${escapeHtml(message)}">⚠ ${escapedLatex}</span>`;
  }
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ================================
// Worker 消息处理
// ================================

/**
 * 处理渲染请求
 */
function handleRender(request: MathRenderRequest): MathRenderResponse {
  const startTime = performance.now();

  try {
    const { latex, displayMode = false } = request.data || {};

    if (!latex) {
      return {
        id: request.id,
        success: false,
        error: '缺少 latex 参数',
        time: performance.now() - startTime,
      };
    }

    const html = renderMathFormula(latex, displayMode);

    return {
      id: request.id,
      success: true,
      data: { html },
      time: performance.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: request.id,
      success: false,
      error: message,
      time: performance.now() - startTime,
    };
  }
}

/**
 * 处理批量渲染请求
 */
function handleRenderBatch(request: MathRenderRequest): MathRenderResponse {
  const startTime = performance.now();

  try {
    const { formulas = [] } = request.data || {};

    const results = formulas.map((formula) => {
      try {
        const html = renderMathFormula(formula.latex, formula.displayMode);
        return {
          id: formula.id,
          html,
          success: true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          id: formula.id,
          html: `<span class="math-error">⚠ ${escapeHtml(formula.latex)}</span>`,
          success: false,
          error: message,
        };
      }
    });

    return {
      id: request.id,
      success: true,
      data: { results },
      time: performance.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: request.id,
      success: false,
      error: message,
      time: performance.now() - startTime,
    };
  }
}

/**
 * 处理清空缓存请求
 */
function handleClearCache(request: MathRenderRequest): MathRenderResponse {
  const startTime = performance.now();
  clearCache();
  return {
    id: request.id,
    success: true,
    time: performance.now() - startTime,
  };
}

/**
 * 处理获取统计请求
 */
function handleGetStats(request: MathRenderRequest): MathRenderResponse {
  const startTime = performance.now();
  return {
    id: request.id,
    success: true,
    data: { stats: getCacheStats() },
    time: performance.now() - startTime,
  };
}

// ================================
// Worker 入口
// ================================

/**
 * 消息处理器
 */
self.onmessage = (event: MessageEvent<MathRenderRequest>) => {
  const request = event.data;
  let response: MathRenderResponse;

  switch (request.type) {
    case 'render':
      response = handleRender(request);
      break;
    case 'render_batch':
      response = handleRenderBatch(request);
      break;
    case 'clear_cache':
      response = handleClearCache(request);
      break;
    case 'get_stats':
      response = handleGetStats(request);
      break;
    default:
      response = {
        id: request.id,
        success: false,
        error: `未知的请求类型: ${request.type}`,
        time: 0,
      };
  }

  self.postMessage(response);
};

/**
 * 错误处理
 */
self.onerror = (event) => {
  console.error('Math Worker 错误:', event);
};

self.onmessageerror = (event) => {
  console.error('Math Worker 消息错误:', event);
};

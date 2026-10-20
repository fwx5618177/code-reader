import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { rm } from 'fs/promises';
import { build } from 'esbuild';
import { ocrAssetsPlugin } from './scripts/ocr-assets';

/**
 * 构建前清空渲染进程的输出目录。
 * 主进程与预加载脚本也写在 dist 下，整体的 emptyOutDir 只能关闭；否则每次构建的带哈希 chunk 都会留在 dist/render/chunks，
 * 越积越多，并被 electron-builder（files: dist/**）一并打进安装包
 */
function cleanRenderOutputPlugin(): Plugin {
  return {
    name: 'clean-render-output',
    apply: 'build',
    async buildStart() {
      await rm(resolve(__dirname, 'dist/render'), { recursive: true, force: true });
    },
  };
}

/**
 * Vite plugin to build Electron main process and preload script using esbuild
 */
function electronMainPlugin(): Plugin {
  const buildElectron = async () => {
    const isDev = process.env.NODE_ENV === 'development';

    // Common esbuild options
    const commonOptions = {
      bundle: true,
      platform: 'node' as const,
      target: 'node18',
      sourcemap: isDev,
      minify: !isDev,
      external: ['electron', 'better-sqlite3'],
    };

    // Build main process (ESM)
    await build({
      ...commonOptions,
      entryPoints: [resolve(__dirname, 'src/main/index.ts')],
      outfile: resolve(__dirname, 'dist/main/index.mjs'),
      format: 'esm',
      banner: {
        js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
      },
    });

    // Build preload script (CommonJS - required by Electron sandbox)
    await build({
      ...commonOptions,
      entryPoints: [resolve(__dirname, 'src/main/preload.ts')],
      outfile: resolve(__dirname, 'dist/main/preload.cjs'),
      format: 'cjs',
    });

    console.log('[Vite Plugin] Electron main & preload built successfully');
  };

  return {
    name: 'electron-main-plugin',
    async buildStart() {
      await buildElectron();
    },
  };
}

export default defineConfig({
  plugins: [cleanRenderOutputPlugin(), electronMainPlugin(), ocrAssetsPlugin(__dirname), react()],
  server: {
    port: 5173,
    strictPort: true,
    hmr: true,
  },
  build: {
    outDir: './dist',
    emptyOutDir: false,
    sourcemap: process.env.NODE_ENV === 'development',
    minify: process.env.NODE_ENV === 'production',
    rollupOptions: {
      input: {
        render: resolve(__dirname, 'index.html'),
      },
      output: {
        entryFileNames: 'render/[name].js',
        chunkFileNames: 'render/chunks/[name].[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || '';
          const ext = name.split('.').pop();

          if (ext === 'css') {
            return 'render/styles/[name].[hash].[ext]';
          }
          return 'render/assets/[name].[hash].[ext]';
        },
        manualChunks: (id) => {
          // React core
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react-vendor';
          }

          // CodeMirror - split into separate chunk (loaded when editing code)
          if (id.includes('node_modules/@codemirror/') || id.includes('node_modules/@lezer/')) {
            return 'codemirror-vendor';
          }

          // ProseMirror - split into separate chunk (loaded when editing rich text)
          if (id.includes('node_modules/prosemirror-')) {
            return 'prosemirror-vendor';
          }

          // Lucide icons - frequently used but can be lazy loaded
          if (id.includes('node_modules/lucide-react/')) {
            return 'icons-vendor';
          }

          // OpenAI/Anthropic SDKs - only needed for AI features
          if (id.includes('node_modules/openai/') || id.includes('node_modules/@anthropic-ai/')) {
            return 'ai-vendor';
          }

          // Prism.js - code highlighting
          if (id.includes('node_modules/prismjs/')) {
            return 'prism-vendor';
          }

          // React Window - virtualization
          if (id.includes('node_modules/react-window/')) {
            return 'virtualization-vendor';
          }

          // pdf.js 仅在打开 PDF 时动态加载，不并入启动即加载的 vendor（含 Worker 与按需加载的 CMap/字体）
          if (id.includes('node_modules/pdfjs-dist/')) {
            return undefined;
          }

          // Other node_modules go to common vendor
          if (id.includes('node_modules/')) {
            return 'vendor';
          }

          return undefined;
        },
      },
    },
    // Increase warning limit since we're intentionally chunking
    chunkSizeWarningLimit: 600,
  },
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});

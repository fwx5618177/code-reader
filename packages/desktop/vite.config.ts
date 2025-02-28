import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    hmr: true,
  },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: process.env.NODE_ENV === 'production',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/main/index.ts'),
        render: resolve(__dirname, 'index.html'),
        preload: resolve(__dirname, 'src/main/preload.ts'),
      },
      output: {
        format: 'esm',
        entryFileNames: (chunkInfo) => {
          return chunkInfo.name === 'main'
            ? 'main/index.mjs'
            : chunkInfo.name === 'preload'
              ? 'main/[name].mjs'
              : 'render/[name].js';
        },
        chunkFileNames: 'render/chunks/[name].[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || '';
          const info = name.split('.');
          const ext = info.pop();

          if (name.endsWith('.html')) {
            return 'render/[name].[ext]';
          }
          if (ext === 'css') {
            return 'render/styles/[name].[hash].[ext]';
          }
          return 'render/assets/[name].[hash].[ext]';
        },
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
        },
      },
      external: ['electron', 'path', 'url', 'fs/promises'],
    },
  },
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});

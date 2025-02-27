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
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/main/index.ts'),
        render: resolve(__dirname, 'index.html'),
      },
      output: {
        format: 'esm',
        entryFileNames: (chunkInfo) => {
          return chunkInfo.name === 'main' ? 'main/index.mjs' : 'render/[name].js';
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
      },
      external: ['electron', 'path', 'url'],
    },
  },
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});

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
        renderer: resolve(__dirname, 'src/render/index.html'),
      },
      output: {
        format: 'esm',
        entryFileNames: (chunkInfo) => {
          return chunkInfo.name === 'main' ? 'main/index.mjs' : 'render/[name].js';
        },
        chunkFileNames: 'render/[name].[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'index.html') {
            return 'render/[name].[ext]';
          }
          return 'render/assets/[name].[hash].[ext]';
        },
      },
      external: ['electron', 'path', 'url'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});

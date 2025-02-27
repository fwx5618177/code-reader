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
        index: resolve(__dirname, 'src/main/index.ts'),
        renderer: resolve(__dirname, 'src/render/index.html'),
      },
      output: {
        format: 'esm',
        entryFileNames: (chunkInfo) => {
          return chunkInfo.name === 'index' ? 'main/[name].mjs' : 'render/[name].js';
        },
        chunkFileNames: 'render/[name].[hash].js',
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name?.split('.');
          const ext = info?.pop();
          const name = info?.join('.');

          if (assetInfo.name === 'index.html') {
            return 'render/[name].[ext]';
          }
          if (ext === 'css') {
            return 'render/styles/[name].[hash].[ext]';
          }
          if (/\.(png|jpe?g|gif|svg|webp|ico)$/.test(assetInfo.name || '')) {
            return 'render/images/[name].[hash].[ext]';
          }
          if (/\.(woff2?|eot|ttf|otf)$/.test(assetInfo.name || '')) {
            return 'render/fonts/[name].[hash].[ext]';
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

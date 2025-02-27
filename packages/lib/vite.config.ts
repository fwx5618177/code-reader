import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  build: {
    lib: {
      entry: './src/index.ts',
      name: 'CodeReaderLib',
      fileName: (format) => `code-reader-lib.${format}.js`,
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: ['d3'],
      output: {
        globals: {
          d3: 'd3'
        }
      }
    }
  },
  plugins: [dts()]
})

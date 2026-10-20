/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    // Test environment
    environment: 'jsdom',

    // Global test setup
    globals: true,

    // Setup files to run before each test file
    setupFiles: ['./src/test/setup.ts'],

    // 测试文件匹配：仅 *.test / *.spec 文件；__tests__ 下的 setup.ts 等辅助模块由测试按需导入，不作为测试执行
    include: ['src/**/*.{test,spec}.{ts,tsx}'],

    // Exclude patterns
    exclude: [
      'node_modules',
      'dist',
      'src/**/*.d.ts',
    ],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'src/render/lib/writing/**/*.ts',
        'src/render/lib/search/**/*.ts',
        'src/render/lib/diff/**/*.ts',
      ],
      exclude: [
        'src/**/*.d.ts',
        'src/**/__tests__/**',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/test/**',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },

    // Timeout for tests
    testTimeout: 10000,

    // Hook timeout
    hookTimeout: 10000,

    // Number of threads
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 4,
        minThreads: 1,
      },
    },

    // Reporter
    reporter: ['verbose', 'html'],

    // Output directory for html reporter
    outputFile: {
      html: './test-results/index.html',
    },

    // Mock clear and reset behavior
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,

    // Resolve aliases (match vite.config.ts)
    alias: {
      '@': resolve(__dirname, './src'),
      '@render': resolve(__dirname, './src/render'),
      '@lib': resolve(__dirname, './src/render/lib'),
    },

    // Deps configuration for proper ESM handling
    deps: {
      interopDefault: true,
    },
  },
});

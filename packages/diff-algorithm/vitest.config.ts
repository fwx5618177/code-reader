import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 测试环境
    environment: 'node',

    // 包含的测试文件模式
    include: ['__tests__/**/*.test.ts'],

    // 排除的文件
    exclude: ['node_modules', 'dist'],

    // 全局 API
    globals: true,

    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },

    // 超时配置
    testTimeout: 10000,

    // 重试配置
    retry: 0,

    // 并发配置
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },

    // 报告器配置
    reporters: ['default'],

    // 快照配置
    snapshotFormat: {
      printBasicPrototype: false,
    },
  },
});

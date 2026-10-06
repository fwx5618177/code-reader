// ================================
// Diff 算法基准测试入口
// ================================

export {
  DiffBenchmark,
  formatReport,
  exportReportAsJSON,
  runQuickBenchmark,
  runFullBenchmark,
  QUICK_PROFILE,
  FULL_PROFILE,
  type SamplingConfig,
  type BenchmarkConfig,
  type BenchmarkResult,
  type BenchmarkReport,
} from './diff-benchmark';

// ================================
// CLI 入口
// ================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isQuick = args.includes('--quick') || args.includes('-q');
  const isVerbose = args.includes('--verbose') || args.includes('-v');
  const outputJson = args.includes('--json');

  console.log('================================');
  console.log(' @code-reader/diff-algorithm');
  console.log(' 基准测试工具');
  console.log('================================\n');

  if (isQuick) {
    console.log('运行模式: 快速测试\n');
  } else {
    console.log('运行模式: 完整测试\n');
  }

  const { runQuickBenchmark, runFullBenchmark, formatReport, exportReportAsJSON } = await import(
    './diff-benchmark'
  );

  const report = isQuick ? runQuickBenchmark(isVerbose) : runFullBenchmark(isVerbose);

  if (outputJson) {
    console.log(exportReportAsJSON(report));
  } else {
    console.log(formatReport(report));
  }

  console.log('\n基准测试完成');
}

// 如果作为主模块运行
if (typeof process !== 'undefined' && process.argv[1]?.includes('index')) {
  main().catch((error) => {
    console.error('基准测试失败:', error);
    process.exit(1);
  });
}

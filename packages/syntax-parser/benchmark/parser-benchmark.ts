// ================================
// 解析器性能基准测试
// ================================

import { createLatexBlockScanner } from '../src/block-scanner';

import { createLatexLezerParser } from '../src/lezer';

// ================================
// 测试数据生成
// ================================

function generateLatexDocument(sections: number, paragraphsPerSection: number): string {
  const lines: string[] = [];

  lines.push('\\documentclass{article}');
  lines.push('\\usepackage[utf8]{inputenc}');
  lines.push('\\title{Benchmark Document}');
  lines.push('\\author{Test}');
  lines.push('\\begin{document}');
  lines.push('\\maketitle');

  for (let s = 1; s <= sections; s++) {
    lines.push(`\\section{Section ${s}}`);

    for (let p = 1; p <= paragraphsPerSection; p++) {
      lines.push(
        `This is paragraph ${p} of section ${s}. It contains some text and math: $x^${p} + y^${s} = z$.`
      );
      lines.push('');
    }

    if (s % 2 === 0) {
      lines.push('\\begin{equation}');
      lines.push(`E_{${s}} = mc^2 + \\sum_{i=1}^{n} x_i`);
      lines.push('\\end{equation}');
    }
  }

  lines.push('\\end{document}');

  return lines.join('\n');
}

// ================================
// 基准测试函数
// ================================

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  throughput: string;
  documentSize: number;
}

function benchmark(
  name: string,
  fn: () => void,
  iterations: number,
  documentSize: number
): BenchmarkResult {
  const times: number[] = [];

  // 预热
  for (let i = 0; i < 3; i++) {
    fn();
  }

  // 正式测试
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    times.push(end - start);
  }

  const totalTime = times.reduce((a, b) => a + b, 0);
  const avgTime = totalTime / iterations;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const throughput = (documentSize / 1024 / (avgTime / 1000)).toFixed(2);

  return {
    name,
    iterations,
    totalTime,
    avgTime,
    minTime,
    maxTime,
    throughput: `${throughput} KB/s`,
    documentSize,
  };
}

function formatResult(result: BenchmarkResult): string {
  return `
${result.name}
${'='.repeat(50)}
  文档大小: ${(result.documentSize / 1024).toFixed(2)} KB
  迭代次数: ${result.iterations}
  平均时间: ${result.avgTime.toFixed(3)} ms
  最小时间: ${result.minTime.toFixed(3)} ms
  最大时间: ${result.maxTime.toFixed(3)} ms
  吞吐量:   ${result.throughput}
`;
}

// ================================
// 运行基准测试
// ================================

async function runBenchmarks() {
  console.log('\n🚀 解析器性能基准测试\n');
  console.log('='.repeat(60));

  const results: BenchmarkResult[] = [];

  // 测试不同大小的文档
  const testCases = [
    { sections: 5, paragraphs: 2, name: '小型文档 (~1KB)' },
    { sections: 20, paragraphs: 5, name: '中型文档 (~10KB)' },
    { sections: 50, paragraphs: 10, name: '大型文档 (~50KB)' },
    { sections: 100, paragraphs: 20, name: '超大文档 (~200KB)' },
  ];

  for (const testCase of testCases) {
    const doc = generateLatexDocument(testCase.sections, testCase.paragraphs);
    const docSize = doc.length;

    console.log(`\n📄 ${testCase.name} (${(docSize / 1024).toFixed(2)} KB)`);
    console.log('-'.repeat(50));

    // LatexBlockScanner 测试
    const tsParser = createLatexBlockScanner({ language: 'latex' });
    const tsResult = benchmark(
      `LatexBlockScanner - ${testCase.name}`,
      () => tsParser.parse(doc),
      50,
      docSize
    );
    results.push(tsResult);
    console.log(`  LatexBlockScanner: ${tsResult.avgTime.toFixed(3)} ms (${tsResult.throughput})`);

    // LatexLezerParser 测试
    const latexParser = createLatexLezerParser();
    const latexResult = benchmark(
      `LatexLezerParser - ${testCase.name}`,
      () => latexParser.parse(doc),
      50,
      docSize
    );
    results.push(latexResult);
    console.log(
      `  LatexLezerParser:   ${latexResult.avgTime.toFixed(3)} ms (${latexResult.throughput})`
    );
  }

  // 增量解析测试
  console.log('\n\n📊 增量解析测试');
  console.log('='.repeat(60));

  const baseDoc = generateLatexDocument(20, 5);
  const tsParser = createLatexBlockScanner({ language: 'latex' });
  const latexParser = createLatexLezerParser();

  // 先完整解析
  const tsFullResult = tsParser.parse(baseDoc);
  latexParser.parse(baseDoc);

  // 模拟小改动
  const modifiedDoc = baseDoc + '\n\\section{New Section}\nNew content here.';
  const changes = {
    changes: [
      {
        from: baseDoc.length,
        to: baseDoc.length,
        insert: '\n\\section{New Section}\nNew content here.',
      },
    ],
    oldLength: baseDoc.length,
    newLength: modifiedDoc.length,
  };

  // 增量解析测试
  const tsIncrResult = benchmark(
    'LatexBlockScanner 增量解析',
    () => tsParser.parseIncremental(modifiedDoc, changes, tsFullResult.ast),
    100,
    modifiedDoc.length
  );
  results.push(tsIncrResult);
  console.log(`\n  LatexBlockScanner 增量: ${tsIncrResult.avgTime.toFixed(3)} ms`);

  const latexIncrResult = benchmark(
    'LatexLezerParser 增量解析',
    () =>
      latexParser.parseIncremental(
        modifiedDoc,
        baseDoc.length,
        baseDoc.length,
        modifiedDoc.length - baseDoc.length
      ),
    100,
    modifiedDoc.length
  );
  results.push(latexIncrResult);
  console.log(`  LatexLezerParser 增量:   ${latexIncrResult.avgTime.toFixed(3)} ms`);

  // 总结
  console.log('\n\n📋 测试总结');
  console.log('='.repeat(60));

  for (const result of results) {
    console.log(formatResult(result));
  }

  console.log('\n✅ 基准测试完成！\n');
}

// 运行
runBenchmarks().catch(console.error);

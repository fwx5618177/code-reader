// ================================
// OCR 资源准备（Vite 插件）
// 开发服务启动与构建开始时，把 tesseract.js 的 Worker 脚本、WASM 核心以及 package.json 依赖中
// 全部 @tesseract.js-data/* 语言数据从 node_modules 复制到 assets/ocr：
//   assets/ocr/engine/      worker.min.js、tesseract-core-{simd-lstm,lstm}.wasm.js
//   assets/ocr/languages/   <语言代码>.traineddata.gz
// 与拼写词典（assets/dictionaries）一样作为独立资源文件随应用打包（electron-builder extraResources），
// 运行时由主进程经 ocr-resource:// 协议提供给识别 Worker，不访问 CDN。
// ================================

import { createRequire } from 'module';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from 'fs/promises';
import { dirname, join } from 'path';
import type { Plugin } from 'vite';

/** WASM 核心：只使用 LSTM 引擎，按是否支持 SIMD 二选一（由 tesseract.js 在 Worker 中判断） */
const CORE_FILES = ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'];
const LANGUAGE_PACKAGE_PREFIX = '@tesseract.js-data/';
/** LSTM 引擎使用的整数量化模型（体积小、精度接近 best） */
const LANGUAGE_MODEL_DIR = '4.0.0_best_int';
const LANGUAGE_FILE_SUFFIX = '.traineddata.gz';

interface CopyTask {
  from: string;
  to: string;
}

/** 大小相同视为已是最新（文件随依赖版本变化）；先写临时文件再改名，避免开发服务与构建并发写入同一文件 */
async function copyIfChanged({ from, to }: CopyTask): Promise<void> {
  const [source, target] = await Promise.all([stat(from), stat(to).catch(() => null)]);
  if (target?.size === source.size) return;
  const temp = `${to}.${process.pid}.tmp`;
  await copyFile(from, temp);
  await rename(temp, to);
}

async function languageTasks(packageRoot: string, outDir: string): Promise<CopyTask[]> {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf-8')) as {
    dependencies?: Record<string, string>;
  };
  const require = createRequire(join(packageRoot, 'package.json'));
  return Object.keys(manifest.dependencies ?? {})
    .filter((name) => name.startsWith(LANGUAGE_PACKAGE_PREFIX))
    .map((name) => {
      const code = name.slice(LANGUAGE_PACKAGE_PREFIX.length);
      const packageDir = dirname(require.resolve(`${name}/package.json`));
      return {
        from: join(packageDir, LANGUAGE_MODEL_DIR, `${code}${LANGUAGE_FILE_SUFFIX}`),
        to: join(outDir, `${code}${LANGUAGE_FILE_SUFFIX}`),
      };
    });
}

/** 准备全部 OCR 资源；移除已不在依赖中的语言数据 */
export async function prepareOcrAssets(packageRoot: string): Promise<void> {
  const engineDir = join(packageRoot, 'assets', 'ocr', 'engine');
  const languagesDir = join(packageRoot, 'assets', 'ocr', 'languages');
  await Promise.all([mkdir(engineDir, { recursive: true }), mkdir(languagesDir, { recursive: true })]);

  const require = createRequire(join(packageRoot, 'package.json'));
  const tesseractDir = dirname(require.resolve('tesseract.js/package.json'));
  // tesseract.js-core 是 tesseract.js 的依赖，从 tesseract.js 所在位置解析
  const coreDir = dirname(createRequire(join(tesseractDir, 'package.json')).resolve('tesseract.js-core/package.json'));

  const languages = await languageTasks(packageRoot, languagesDir);
  const tasks: CopyTask[] = [
    { from: join(tesseractDir, 'dist', 'worker.min.js'), to: join(engineDir, 'worker.min.js') },
    ...CORE_FILES.map((file) => ({ from: join(coreDir, file), to: join(engineDir, file) })),
    ...languages,
  ];
  await Promise.all(tasks.map(copyIfChanged));

  const expected = new Set(languages.map(({ to }) => to));
  const stale = (await readdir(languagesDir))
    .map((name) => join(languagesDir, name))
    .filter((path) => path.endsWith(LANGUAGE_FILE_SUFFIX) && !expected.has(path));
  await Promise.all(stale.map((path) => rm(path, { force: true })));
}

export function ocrAssetsPlugin(packageRoot: string): Plugin {
  return {
    name: 'ocr-assets',
    async buildStart() {
      await prepareOcrAssets(packageRoot);
    },
  };
}

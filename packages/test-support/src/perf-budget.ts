// ================================
// 性能断言的耗时预算
// 预算按开发机（Apple Silicon，单独运行）设定，用来发现数量级的退化（例如算法从线性退化成指数）。
// CI 运行器更慢，且多个包的测试并行运行，绝对耗时没有可比性：由环境变量 PERF_BUDGET_SCALE 统一放宽，
// 测试里只写开发机上的预算。做法与 Node.js 测试套件的 common.platformTimeout 相同
// ================================

/** 预算的放大倍数：PERF_BUDGET_SCALE，未设置时为 1 */
export function perfBudgetScale(): number {
  const raw = process.env.PERF_BUDGET_SCALE;
  if (raw === undefined || raw === '') return 1;
  const scale = Number(raw);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(`PERF_BUDGET_SCALE 必须是正数，当前为 ${raw}`);
  return scale;
}

/** 开发机上的耗时预算（毫秒）在当前环境中的值 */
export function perfBudget(ms: number): number {
  return ms * perfBudgetScale();
}

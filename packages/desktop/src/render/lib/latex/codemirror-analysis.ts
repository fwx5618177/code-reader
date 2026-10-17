// ================================
// LaTeX 编辑器的诊断与折叠（CodeMirror 扩展）
//
// 文档变更后防抖请求整篇分析（Worker 中进行），结果一次事务写入：
// - 诊断交给 @codemirror/lint 展示（下划线、行号旁标记、诊断面板），之后的编辑由 lint 状态自行映射位置
// - 折叠区间存入 RangeSet，随编辑映射位置，foldService 按行查询；折叠栏在区间更新时重算
// ================================

import { RangeSet, RangeValue, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import { foldGutter, foldKeymap, foldService } from '@codemirror/language';
import { lintGutter, lintKeymap, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import type { LatexAnalysis, LatexDiagnostic } from './analysis';
import { requestLatexAnalysis } from './analysis-client';

/** 停止输入多久后重新分析（毫秒） */
const ANALYSIS_DELAY_MS = 400;

class FoldMarker extends RangeValue {}
const foldMarker = new FoldMarker();

const setLatexFolds = StateEffect.define<RangeSet<FoldMarker>>();

const latexFoldsField = StateField.define<RangeSet<FoldMarker>>({
  create: () => RangeSet.empty,
  update(folds, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setLatexFolds)) return effect.value;
    }
    return tr.docChanged ? folds.map(tr.changes) : folds;
  },
});

/** 起点落在该行内、终点越过行尾的最大区间 */
const latexFoldService = foldService.of((state, lineStart, lineEnd) => {
  let found: { from: number; to: number } | null = null;
  state.field(latexFoldsField).between(lineStart, lineEnd, (from, to) => {
    if (from >= lineStart && from <= lineEnd && to > lineEnd && (!found || to > found.to)) {
      found = { from, to };
    }
  });
  return found;
});

const SOURCE_LABELS: Record<LatexDiagnostic['source'], string> = {
  syntax: 'LaTeX 语法',
  reference: 'LaTeX 引用',
};

function toEditorDiagnostics(diagnostics: LatexDiagnostic[], doc: Text): Diagnostic[] {
  return diagnostics.map((diagnostic) => {
    const from = Math.min(diagnostic.from, doc.length);
    return {
      from,
      to: Math.min(Math.max(diagnostic.to, from), doc.length),
      severity: diagnostic.severity,
      message: diagnostic.message,
      source: SOURCE_LABELS[diagnostic.source],
    };
  });
}

function toFoldSet(analysis: LatexAnalysis, doc: Text): RangeSet<FoldMarker> {
  return RangeSet.of(
    analysis.folds
      .filter((fold) => fold.to <= doc.length)
      .map((fold) => foldMarker.range(fold.from, fold.to)),
    true
  );
}

/**
 * 编辑器扩展：诊断（下划线 + 行号旁标记 + 诊断面板 ⌘⇧M / F8 跳转）与折叠（折叠栏 + ⌘⌥[ / ⌘⌥]）
 * @param onAnalysis 每次分析结果写入编辑器后回调（用于头部诊断计数）
 */
export function latexAnalysis(onAnalysis: (analysis: LatexAnalysis) => void): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private destroyed = false;

      constructor(private readonly view: EditorView) {
        this.schedule(0);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) this.schedule(ANALYSIS_DELAY_MS);
      }

      destroy() {
        this.destroyed = true;
        if (this.timer) clearTimeout(this.timer);
      }

      private schedule(delay: number) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.analyze();
        }, delay);
      }

      private async analyze() {
        const doc = this.view.state.doc;
        const analysis = await requestLatexAnalysis(doc.toString());
        // 分析期间文档又变了：结果作废，等待已排程的下一次分析
        if (this.destroyed || this.view.state.doc !== doc) return;
        const lint = setDiagnostics(this.view.state, toEditorDiagnostics(analysis.diagnostics, doc));
        const lintEffects = lint.effects ? (Array.isArray(lint.effects) ? lint.effects : [lint.effects]) : [];
        this.view.dispatch({ effects: [...lintEffects, setLatexFolds.of(toFoldSet(analysis, doc))] });
        onAnalysis(analysis);
      }
    }
  );

  return [
    latexFoldsField,
    latexFoldService,
    plugin,
    foldGutter({
      foldingChanged: (update) =>
        update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setLatexFolds))),
    }),
    lintGutter(),
    keymap.of([...foldKeymap, ...lintKeymap]),
  ];
}

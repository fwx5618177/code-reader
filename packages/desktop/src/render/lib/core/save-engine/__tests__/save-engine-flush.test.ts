import { describe, it, expect, vi, afterEach } from 'vitest';
import { createEditorModel, DocumentEditorManager, type ContentSnapshot } from '../../editor-model';
import { SaveEngine, createFailedResult, createSuccessResult, type SaveResult } from '..';

/** 记录快照、可手动控制完成时机的保存执行器 */
function controlledExecutor() {
  const saved: ContentSnapshot[] = [];
  const resolvers: Array<() => void> = [];
  const save = vi.fn(
    (snapshot: ContentSnapshot) =>
      new Promise<SaveResult>((resolve) => {
        resolvers.push(() => {
          saved.push(snapshot);
          resolve(createSuccessResult(snapshot.versionId, snapshot.contentHash, snapshot.documentId));
        });
      })
  );
  return { executor: { save }, save, saved, resolveNext: () => resolvers.shift()?.() };
}

function createEngine(executor: { save: (snapshot: ContentSnapshot) => Promise<SaveResult> }) {
  // 空文档视为无未保存的更改
  const model = createEditorModel({ documentId: 'doc', initialTitle: '', initialContent: '' });
  const engine = new SaveEngine({
    contentProvider: model,
    executor,
    // 与 useManagedEditor 一致：保存成功后由监听方标记模型已保存
    onEvent: (event) => {
      if (event.type === 'SAVE_SUCCESS') {
        model.markAsSaved(event.result.savedVersionId, event.result.savedContentHash);
      }
    },
  });
  return { model, engine };
}

/** 让挂起的 Promise 回调全部执行 */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('SaveEngine.flush', () => {
  it('等待进行中的保存结束，再保存其后的最新内容', async () => {
    const { executor, save, saved, resolveNext } = controlledExecutor();
    const { model, engine } = createEngine(executor);

    model.updateContent('<p>A</p>');
    const inFlight = engine.saveNow();
    model.updateContent('<p>B</p>');

    const flushing = engine.flush();
    await settle();
    // 进行中的保存未结束前不会发起第二次保存
    expect(save).toHaveBeenCalledTimes(1);

    resolveNext();
    await inFlight;
    await settle();
    expect(save).toHaveBeenCalledTimes(2);

    resolveNext();
    const result = await flushing;
    expect(result?.success).toBe(true);
    expect(saved.map((snapshot) => snapshot.content)).toEqual(['<p>A</p>', '<p>B</p>']);
    expect(engine.hasUnsavedChanges()).toBe(false);
    engine.destroy();
  });

  it('没有未保存的更改时不调用执行器', async () => {
    const { executor, save } = controlledExecutor();
    const { engine } = createEngine(executor);

    await expect(engine.flush()).resolves.toBeNull();
    expect(save).not.toHaveBeenCalled();
    engine.destroy();
  });

  it('关闭自动保存时仍写回未保存的更改', async () => {
    const { executor, save, resolveNext } = controlledExecutor();
    const { model, engine } = createEngine(executor);
    engine.setAutoSaveEnabled(false);
    model.updateContent('<p>A</p>');

    const flushing = engine.flush();
    await settle();
    resolveNext();
    expect((await flushing)?.success).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    engine.destroy();
  });

  it('执行器同步抛错时不会卡住后续落盘', async () => {
    const { model, engine } = createEngine({
      save: () => {
        throw new Error('同步失败');
      },
    });
    model.updateContent('<p>A</p>');

    expect((await engine.saveNow()).success).toBe(false);
    await settle();
    const result = await engine.flush();
    expect(result?.success).toBe(false);
    engine.destroy();
  });
});

describe('DocumentEditorManager.flushAll', () => {
  afterEach(() => {
    DocumentEditorManager.resetInstance();
  });

  it('写回全部实例（含已释放的缓存实例），汇总失败的文档', async () => {
    const manager = DocumentEditorManager.getInstance({ unusedInstanceTTL: 0 });
    const ok = vi.fn((snapshot: ContentSnapshot) =>
      Promise.resolve(createSuccessResult(snapshot.versionId, snapshot.contentHash, snapshot.documentId))
    );
    const failing = vi.fn((snapshot: ContentSnapshot) =>
      Promise.resolve(createFailedResult('磁盘已满', snapshot.versionId))
    );

    const released = manager.acquire('released', { executor: { save: ok } }).instance;
    released.model.updateContent('<p>released</p>');
    manager.release('released');
    const broken = manager.acquire('broken', { executor: { save: failing } }).instance;
    broken.model.updateContent('<p>broken</p>');
    manager.acquire('clean', { executor: { save: ok } });

    await expect(manager.flushAll()).rejects.toThrow(/broken: 磁盘已满/);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(ok.mock.calls[0][0].documentId).toBe('released');
    expect(failing).toHaveBeenCalledTimes(1);
  });
});

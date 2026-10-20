// ================================
// EditorModel 的内容哈希按需计算：输入时不整篇哈希，保存与比较时结果与立即计算一致
// ================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hashCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../delta', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../delta')>();
  return {
    ...actual,
    hashContent: (content: string) => {
      hashCalls.count++;
      return actual.hashContent(content);
    },
  };
});

import { hashContent } from '../../delta/content-hasher';
import { EditorModel } from '../editor-model';

const expected = (title: string, content: string) => hashContent(`${title}\n---\n${content}`);

describe('EditorModel 内容哈希', () => {
  beforeEach(() => {
    hashCalls.count = 0;
  });

  it('编辑与判断有无未保存修改都不计算哈希（已知保存时的内容）', () => {
    const model = new EditorModel({ documentId: 'd', initialTitle: 't', initialContent: 'a' });
    const snapshot = model.getSnapshot()!;
    model.markAsSaved(snapshot.versionId, snapshot.contentHash);
    hashCalls.count = 0;

    for (const text of ['ab', 'abc', 'abcd']) {
      model.updateContent(text);
      expect(model.hasUnsavedChanges()).toBe(true);
    }
    model.updateContent('a');
    expect(model.hasUnsavedChanges()).toBe(false);
    expect(hashCalls.count).toBe(0);
  });

  it('保存进行中继续输入：按快照版本确认保存后仍不需要哈希', () => {
    const model = new EditorModel({ documentId: 'd', initialContent: 'x' });
    model.updateContent('x1');
    const inFlight = model.getSnapshot()!;
    model.updateContent('x12');
    model.updateContent('x123');
    hashCalls.count = 0;

    model.markAsSaved(inFlight.versionId, inFlight.contentHash);
    expect(model.hasUnsavedChanges()).toBe(true);
    model.updateContent('x1');
    expect(model.hasUnsavedChanges()).toBe(false);
    expect(hashCalls.count).toBe(0);
  });

  it('快照、父版本与变更事件中的哈希与立即计算的结果一致', () => {
    const model = new EditorModel({ documentId: 'd', initialTitle: '标题', initialContent: '正文' });
    const events: Array<{ previous: string; next: string }> = [];
    model.onContentChange((event) => events.push({ previous: event.previousContentHash, next: event.newContentHash }));

    model.updateContent('正文2');
    model.updateTitle('新标题');
    const snapshot = model.getSnapshot()!;

    expect(snapshot.contentHash).toBe(expected('新标题', '正文2'));
    expect(snapshot.parentContentHash).toBe(expected('标题', '正文2'));
    expect(model.getParentVersion()?.contentHash).toBe(expected('标题', '正文2'));
    expect(events).toEqual([
      { previous: expected('标题', '正文'), next: expected('标题', '正文2') },
      { previous: expected('标题', '正文2'), next: expected('新标题', '正文2') },
    ]);
  });

  it('不知道保存时的内容时按哈希比较；传入的初始哈希直接使用', () => {
    const model = new EditorModel({ documentId: 'd', initialContent: 'a', initialContentHash: 'given' });
    expect(model.getContentHash()).toBe('given');
    model.updateContent('b');
    model.markAsSaved(model.getVersionId() + 10, expected('', 'b'));
    expect(model.hasUnsavedChanges()).toBe(false);
  });
});

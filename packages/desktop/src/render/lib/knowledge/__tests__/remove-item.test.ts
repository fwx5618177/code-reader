// ================================
// 删除条目测试：软删除后清理该条目的文字识别缓存；清理失败不影响删除
// ================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeKnowledgeItem } from '../service';
import { knowledgeRepository } from '../repository';

vi.mock('../repository', () => ({
  knowledgeRepository: { remove: vi.fn() },
}));

describe('removeKnowledgeItem', () => {
  const removeResults = vi.fn();
  const remove = vi.mocked(knowledgeRepository.remove);

  beforeEach(() => {
    remove.mockReset().mockResolvedValue(undefined);
    removeResults.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('electron', { ocr: { removeResults } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('软删除条目后清理该条目的识别缓存', async () => {
    await removeKnowledgeItem('item-1');

    expect(remove).toHaveBeenCalledWith('item-1');
    expect(removeResults).toHaveBeenCalledWith('item-1');
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(removeResults.mock.invocationCallOrder[0]);
  });

  it('删除失败时不清理缓存，错误交给调用方', async () => {
    remove.mockRejectedValue(new Error('数据库不可用'));

    await expect(removeKnowledgeItem('item-1')).rejects.toThrow('数据库不可用');
    expect(removeResults).not.toHaveBeenCalled();
  });

  it('清理缓存失败只记录错误，删除仍视为成功', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    removeResults.mockRejectedValue(new Error('权限不足'));

    await expect(removeKnowledgeItem('item-1')).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('[Knowledge] 清理文字识别缓存失败:', 'item-1', expect.any(Error));
  });
});

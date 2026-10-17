// ================================
// 版本服务测试：新增版本后自动清理（只保留最近 50 个）、按需获取上一版本
// ================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { versionService } from '../service';
import { versionRepository } from '../repository';
import type { DocumentVersion } from '../types';

vi.mock('../repository', () => ({
  versionRepository: {
    create: vi.fn(),
    autoSave: vi.fn(),
    restore: vi.fn(),
    prune: vi.fn(),
    getByNumber: vi.fn(),
  },
}));

const version = { id: 'v1', itemId: 'doc', versionNumber: 1 } as DocumentVersion;

describe('versionService 自动清理旧版本', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(versionRepository.prune).mockResolvedValue(0);
  });

  it('手动保存后按保留 50 个版本清理', async () => {
    vi.mocked(versionRepository.create).mockResolvedValue(version);
    await versionService.createSaveVersion('doc', '内容');
    expect(versionRepository.prune).toHaveBeenCalledWith('doc', 50);
  });

  it('自动保存创建了版本才清理，未达到间隔（返回 null）时不清理', async () => {
    vi.mocked(versionRepository.autoSave).mockResolvedValueOnce(null);
    await versionService.createAutoSaveVersion('doc', '内容');
    expect(versionRepository.prune).not.toHaveBeenCalled();

    vi.mocked(versionRepository.autoSave).mockResolvedValueOnce(version);
    await versionService.createAutoSaveVersion('doc', '内容');
    expect(versionRepository.prune).toHaveBeenCalledWith('doc', 50);
  });

  it('恢复版本（会新增一个版本）后清理', async () => {
    vi.mocked(versionRepository.restore).mockResolvedValue(version);
    await versionService.restoreVersion('doc', 'v0');
    expect(versionRepository.prune).toHaveBeenCalledWith('doc', 50);
  });

  it('清理失败不影响已创建的版本', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(versionRepository.create).mockResolvedValue(version);
    vi.mocked(versionRepository.prune).mockRejectedValue(new Error('db busy'));
    await expect(versionService.createSaveVersion('doc', '内容')).resolves.toBe(version);
  });
});

describe('versionService.getVersionBefore', () => {
  it('按版本号减 1 从仓库读取上一版本', async () => {
    const previous = { id: 'v4', itemId: 'doc', versionNumber: 4 } as DocumentVersion;
    vi.mocked(versionRepository.getByNumber).mockResolvedValue(previous);
    const current = { id: 'v5', itemId: 'doc', versionNumber: 5 } as DocumentVersion;
    await expect(versionService.getVersionBefore(current)).resolves.toBe(previous);
    expect(versionRepository.getByNumber).toHaveBeenCalledWith('doc', 4);
  });

  it('第一版没有上一版本，不查询仓库', async () => {
    await expect(versionService.getVersionBefore(version)).resolves.toBeNull();
    expect(versionRepository.getByNumber).not.toHaveBeenCalled();
  });

  it('上一版本已被清理时返回 null', async () => {
    vi.mocked(versionRepository.getByNumber).mockResolvedValue(null);
    const oldestKept = { id: 'v51', itemId: 'doc', versionNumber: 51 } as DocumentVersion;
    await expect(versionService.getVersionBefore(oldestKept)).resolves.toBeNull();
  });
});

// ================================
// 版本保留策略测试：新增版本后自动清理，只保留最近 50 个
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

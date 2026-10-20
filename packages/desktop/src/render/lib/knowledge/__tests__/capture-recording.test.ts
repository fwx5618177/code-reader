// ================================
// 快速收集录音：录音的已知时长写入条目 metadata.durationMs（数据库、附件写入与 Agent 均为假实现）
// ================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureQuickInput } from '../service';

const create = vi.hoisted(() => vi.fn((input: Record<string, unknown>) => Promise.resolve({ id: 'k1', ...input })));

vi.mock('../../../services/database', () => ({ databaseService: { initialize: () => Promise.resolve() } }));
vi.mock('../../../services/settingsService', () => ({ settingsService: { get: () => Promise.resolve({ enableAI: false }) } }));
vi.mock('../../../services/workspaceService', () => ({
  workspaceService: { getCurrent: () => Promise.resolve({ attachmentsPath: '/ws/attachments' }) },
}));
vi.mock('../../../services/aiConfigService', () => ({ aiConfigService: { hasUsableProvider: () => Promise.resolve(false) } }));
vi.mock('../../agent/agentStore', () => ({ agentActivity: { attach: vi.fn(), process: vi.fn() } }));
vi.mock('../legacy-migration', () => ({ migrateLegacyKnowledgeStore: () => Promise.resolve() }));
vi.mock('../document-text', () => ({ extractDocumentText: () => Promise.resolve(null) }));
vi.mock('../repository', () => ({ knowledgeRepository: { create, setItemTags: vi.fn() } }));

/** jsdom 的 File 没有 arrayBuffer，补上供保存附件使用 */
function recording(): File {
  const file = new File([new Blob(['audio'])], 'recording-1.webm', { type: 'audio/webm' });
  return Object.assign(file, { arrayBuffer: () => Promise.resolve(new ArrayBuffer(5)) });
}

describe('captureQuickInput 录音时长', () => {
  beforeEach(() => {
    create.mockClear();
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { ipcRenderer: { invoke: vi.fn(() => Promise.resolve()) } },
    });
  });

  it('保存录音时把已知时长写入 metadata.durationMs', async () => {
    const file = recording();
    await captureQuickInput({
      type: 'voice',
      content: '[语音录音 01:05]',
      attachments: [file],
      recordingDurationsMs: new Map([[file, 65_000]]),
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'audio', metadata: { durationMs: 65_000 } })
    );
  });

  it('附件没有已知时长时不写入 metadata', async () => {
    await captureQuickInput({ type: 'voice', content: '', attachments: [recording()] });
    expect(create.mock.calls[0][0].metadata).toBeUndefined();
  });
});

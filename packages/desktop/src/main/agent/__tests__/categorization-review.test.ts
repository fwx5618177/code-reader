// ================================
// 自动归类提议审阅测试：IPC 参数校验与状态流转
// ================================

import { describe, it, expect } from 'vitest';
import { parseReviewDecisions, resolveReviewDecision, type StoredProposal } from '../categorization-review';

const itemProposal = (overrides: Partial<StoredProposal> = {}): StoredProposal => ({
  kind: 'item',
  status: 'pending',
  folderId: 'f1',
  folderName: '工作',
  tags: ['AI'],
  ...overrides,
});

const mergeProposal = (overrides: Partial<StoredProposal> = {}): StoredProposal => ({
  kind: 'tag-merge',
  status: 'pending',
  folderId: null,
  folderName: null,
  tags: [],
  ...overrides,
});

describe('parseReviewDecisions', () => {
  it('接受合法的决定，applied 可选', () => {
    expect(
      parseReviewDecisions([
        { id: 'p1', status: 'accepted' },
        { id: 'p2', status: 'rejected' },
        { id: 'p3', status: 'accepted', applied: { folderId: null, folderName: '读书', tags: ['Rust'] } },
      ])
    ).toEqual([
      { id: 'p1', status: 'accepted' },
      { id: 'p2', status: 'rejected' },
      { id: 'p3', status: 'accepted', applied: { folderId: null, folderName: '读书', tags: ['Rust'] } },
    ]);
  });

  it('结构不合法时抛错', () => {
    expect(() => parseReviewDecisions({})).toThrow('数组');
    expect(() => parseReviewDecisions([{ status: 'accepted' }])).toThrow('ID');
    expect(() => parseReviewDecisions([{ id: 'p1', status: 'pending' }])).toThrow('未知的审阅结果');
    expect(() => parseReviewDecisions([{ id: 'p1', status: 'accepted', applied: { tags: 'x' } }])).toThrow('applied');
    expect(() =>
      parseReviewDecisions([{ id: 'p1', status: 'accepted', applied: { folderId: 1, folderName: null, tags: [] } }])
    ).toThrow('folderId');
    expect(() =>
      parseReviewDecisions([{ id: 'p1', status: 'accepted', applied: { folderId: null, folderName: null, tags: [1] } }])
    ).toThrow('tags');
  });
});

describe('resolveReviewDecision', () => {
  it('pending → accepted：未修改时按原提议记录', () => {
    expect(resolveReviewDecision(itemProposal(), { id: 'p', status: 'accepted' })).toEqual({
      status: 'accepted',
      folderId: 'f1',
      folderName: '工作',
      tags: ['AI'],
    });
    expect(resolveReviewDecision(mergeProposal(), { id: 'p', status: 'accepted' }).status).toBe('accepted');
  });

  it('pending → rejected：保留原提议内容，不能附带修改', () => {
    expect(resolveReviewDecision(itemProposal(), { id: 'p', status: 'rejected' })).toEqual({
      status: 'rejected',
      folderId: 'f1',
      folderName: '工作',
      tags: ['AI'],
    });
    expect(() =>
      resolveReviewDecision(itemProposal(), {
        id: 'p',
        status: 'rejected',
        applied: { folderId: null, folderName: null, tags: ['x'] },
      })
    ).toThrow('拒绝');
  });

  it('修改后接受：记录实际应用的目标，标签规范化去重', () => {
    expect(
      resolveReviewDecision(itemProposal(), {
        id: 'p',
        status: 'accepted',
        applied: { folderId: null, folderName: '  读书 ', tags: ['#Rust', 'rust', ' ', 'AI'] },
      })
    ).toEqual({ status: 'accepted', folderId: null, folderName: '读书', tags: ['Rust', 'AI'] });
    // 只追加标签、不移动
    expect(
      resolveReviewDecision(itemProposal(), {
        id: 'p',
        status: 'accepted',
        applied: { folderId: null, folderName: null, tags: ['AI'] },
      })
    ).toEqual({ status: 'accepted', folderId: null, folderName: null, tags: ['AI'] });
  });

  it('非法流转：已审阅的提议、标签合并带修改、没有任何改动、文件夹缺少名称', () => {
    expect(() => resolveReviewDecision(itemProposal({ status: 'accepted' }), { id: 'p', status: 'rejected' })).toThrow(
      '已审阅'
    );
    expect(() => resolveReviewDecision(itemProposal({ status: 'rejected' }), { id: 'p', status: 'accepted' })).toThrow(
      '已审阅'
    );
    const empty = { folderId: null, folderName: null, tags: [] };
    expect(() => resolveReviewDecision(mergeProposal(), { id: 'p', status: 'accepted', applied: empty })).toThrow(
      '只有条目'
    );
    expect(() => resolveReviewDecision(itemProposal(), { id: 'p', status: 'accepted', applied: empty })).toThrow(
      '没有任何改动'
    );
    expect(() =>
      resolveReviewDecision(itemProposal(), {
        id: 'p',
        status: 'accepted',
        applied: { folderId: 'f2', folderName: ' ', tags: [] },
      })
    ).toThrow('名称');
  });
});

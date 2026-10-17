import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VirtualFolders, { type VirtualFolder } from '..';
import { EXPANDED_FOLDERS_STORAGE_KEY } from '../expanded-folders';
import { KNOWLEDGE_FOLDER_DRAG_TYPE, KNOWLEDGE_ITEM_DRAG_TYPE } from '../../../lib/knowledge/drag';

/**
 * 工作（2）
 * └─ 项目（1）
 * 生活
 */
const folders: VirtualFolder[] = [
  {
    id: 'f1',
    name: '工作',
    type: 'manual',
    itemCount: 2,
    children: [{ id: 'f2', name: '项目', type: 'manual', itemCount: 1, children: [] }],
  },
  { id: 'f3', name: '生活', type: 'manual', itemCount: 0, children: [] },
];

function renderFolders(canMoveFolder: (folderId: string, parentId: string | null) => boolean = () => true) {
  const props = {
    folders,
    items: [],
    onFolderSelect: vi.fn(),
    onCreateSubfolder: vi.fn(),
    onEditFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
    onDropItem: vi.fn(),
    onMoveFolder: vi.fn(),
    canMoveFolder: vi.fn(canMoveFolder),
  };
  const result = render(<VirtualFolders {...props} />);
  // 展开「我的文件夹」
  fireEvent.click(screen.getByText('我的文件夹'));
  return { props, ...result };
}

/** 模拟携带条目 ID 的拖动数据 */
function dragData(itemId: string) {
  return {
    types: [KNOWLEDGE_ITEM_DRAG_TYPE],
    getData: (type: string) => (type === KNOWLEDGE_ITEM_DRAG_TYPE ? itemId : ''),
    dropEffect: 'none',
  };
}

/** 模拟拖动文件夹：开始拖动时写入的数据在放下时读出 */
function folderDragData() {
  const data = new Map<string, string>();
  return {
    types: [KNOWLEDGE_FOLDER_DRAG_TYPE],
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    effectAllowed: 'none',
    dropEffect: 'none',
  };
}

/** 展开「工作」以显示子文件夹「项目」 */
function expandWork() {
  const row = screen.getByText('工作').closest('div')!;
  fireEvent.click(row.querySelector('span')!);
}

describe('VirtualFolders', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('右键菜单重命名 / 删除用户文件夹', () => {
    const { props } = renderFolders();

    fireEvent.contextMenu(screen.getByText('工作'));
    fireEvent.click(screen.getByText('重命名'));
    expect(props.onEditFolder).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));

    fireEvent.contextMenu(screen.getByText('工作'));
    fireEvent.click(screen.getByText('删除'));
    expect(props.onDeleteFolder).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));
  });

  it('「我的文件夹」根节点没有重命名 / 删除菜单', () => {
    renderFolders();
    fireEvent.contextMenu(screen.getByText('我的文件夹'));
    expect(screen.queryByText('重命名')).toBeNull();
  });

  it('条目拖到用户文件夹上触发移动', () => {
    const { props } = renderFolders();
    const target = screen.getByText('工作');

    fireEvent.dragOver(target, { dataTransfer: dragData('n1') });
    fireEvent.drop(target, { dataTransfer: dragData('n1') });
    expect(props.onDropItem).toHaveBeenCalledWith('f1', 'n1');
    expect(props.onMoveFolder).not.toHaveBeenCalled();
  });

  it('智能文件夹不接收拖入的条目', () => {
    const { props } = renderFolders();
    fireEvent.drop(screen.getByText('收藏'), { dataTransfer: dragData('n1') });
    expect(props.onDropItem).not.toHaveBeenCalled();
  });

  describe('嵌套文件夹', () => {
    it('子文件夹默认折叠，点击箭头展开并显示各自的条目数', () => {
      renderFolders();
      expect(screen.queryByText('项目')).toBeNull();

      expandWork();

      const child = screen.getByText('项目').closest('div')!;
      expect(child.textContent).toContain('1');
      expect(screen.getByText('工作').closest('div')!.textContent).toContain('2');
    });

    it('点击有子文件夹的用户文件夹只选中，不折叠', () => {
      const { props } = renderFolders();
      expandWork();

      fireEvent.click(screen.getByText('工作'));

      expect(props.onFolderSelect).toHaveBeenCalledWith('f1');
      expect(screen.getByText('项目')).toBeTruthy();
    });

    it('展开状态保存在 localStorage，重新挂载后保持', () => {
      const { unmount } = renderFolders();
      expandWork();
      expect(JSON.parse(localStorage.getItem(EXPANDED_FOLDERS_STORAGE_KEY) ?? '[]')).toEqual(
        expect.arrayContaining(['smart', 'user', 'f1'])
      );
      unmount();

      render(<VirtualFolders folders={folders} items={[]} onFolderSelect={vi.fn()} />);
      expect(screen.getByText('项目')).toBeTruthy();
    });

    it('右键菜单新建子文件夹，并展开父文件夹', () => {
      const { props } = renderFolders();

      fireEvent.contextMenu(screen.getByText('工作'));
      fireEvent.click(screen.getByText('新建子文件夹'));

      expect(props.onCreateSubfolder).toHaveBeenCalledWith('f1');
      expect(screen.getByText('项目')).toBeTruthy();
    });

    it('文件夹拖到另一个文件夹上：移动到其中', () => {
      const { props } = renderFolders();
      const data = folderDragData();

      fireEvent.dragStart(screen.getByText('生活'), { dataTransfer: data });
      fireEvent.dragOver(screen.getByText('工作'), { dataTransfer: data });
      fireEvent.drop(screen.getByText('工作'), { dataTransfer: data });

      expect(props.canMoveFolder).toHaveBeenCalledWith('f3', 'f1');
      expect(props.onMoveFolder).toHaveBeenCalledWith('f3', 'f1');
      expect(props.onDropItem).not.toHaveBeenCalled();
    });

    it('文件夹拖到「我的文件夹」根节点上：移到顶层', () => {
      const { props } = renderFolders();
      expandWork();
      const data = folderDragData();

      fireEvent.dragStart(screen.getByText('项目'), { dataTransfer: data });
      fireEvent.drop(screen.getByText('我的文件夹'), { dataTransfer: data });

      expect(props.onMoveFolder).toHaveBeenCalledWith('f2', null);
    });

    it('不接收会形成环的目标，也不能拖到自身上', () => {
      // 「工作」不能移到其子文件夹「项目」中
      const { props } = renderFolders((folderId, parentId) => !(folderId === 'f1' && parentId === 'f2'));
      expandWork();
      const data = folderDragData();

      fireEvent.dragStart(screen.getByText('工作'), { dataTransfer: data });
      const overChild = fireEvent.dragOver(screen.getByText('项目'), { dataTransfer: data });
      fireEvent.drop(screen.getByText('项目'), { dataTransfer: data });
      fireEvent.drop(screen.getByText('工作'), { dataTransfer: data });

      // dragover 未被 preventDefault 即表示不可放下
      expect(overChild).toBe(true);
      expect(props.onMoveFolder).not.toHaveBeenCalled();
    });

    it('智能文件夹不接收拖入的文件夹', () => {
      const { props } = renderFolders();
      const data = folderDragData();

      fireEvent.dragStart(screen.getByText('生活'), { dataTransfer: data });
      fireEvent.drop(screen.getByText('收藏'), { dataTransfer: data });

      expect(props.onMoveFolder).not.toHaveBeenCalled();
    });
  });
});

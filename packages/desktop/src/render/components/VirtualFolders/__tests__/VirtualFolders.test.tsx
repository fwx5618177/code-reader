import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VirtualFolders, { type VirtualFolder } from '..';
import { KNOWLEDGE_ITEM_DRAG_TYPE } from '../../../lib/knowledge/drag';

const folders: VirtualFolder[] = [{ id: 'f1', name: '工作', type: 'manual', itemCount: 2 }];

function renderFolders() {
  const props = {
    folders,
    items: [],
    onFolderSelect: vi.fn(),
    onEditFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
    onDropItem: vi.fn(),
  };
  render(<VirtualFolders {...props} />);
  // 展开「我的文件夹」
  fireEvent.click(screen.getByText('我的文件夹'));
  return props;
}

/** 模拟携带条目 ID 的拖动数据 */
function dragData(itemId: string) {
  return {
    types: [KNOWLEDGE_ITEM_DRAG_TYPE],
    getData: (type: string) => (type === KNOWLEDGE_ITEM_DRAG_TYPE ? itemId : ''),
    dropEffect: 'none',
  };
}

describe('VirtualFolders', () => {
  it('右键菜单重命名 / 删除用户文件夹', () => {
    const props = renderFolders();

    fireEvent.contextMenu(screen.getByText('工作'));
    fireEvent.click(screen.getByText('重命名'));
    expect(props.onEditFolder).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));

    fireEvent.contextMenu(screen.getByText('工作'));
    fireEvent.click(screen.getByText('删除'));
    expect(props.onDeleteFolder).toHaveBeenCalledWith('f1');
  });

  it('「我的文件夹」根节点没有重命名 / 删除菜单', () => {
    renderFolders();
    fireEvent.contextMenu(screen.getByText('我的文件夹'));
    expect(screen.queryByText('重命名')).toBeNull();
  });

  it('条目拖到用户文件夹上触发移动', () => {
    const props = renderFolders();
    const target = screen.getByText('工作');

    fireEvent.dragOver(target, { dataTransfer: dragData('n1') });
    fireEvent.drop(target, { dataTransfer: dragData('n1') });
    expect(props.onDropItem).toHaveBeenCalledWith('f1', 'n1');
  });

  it('智能文件夹不接收拖入的条目', () => {
    const props = renderFolders();
    fireEvent.drop(screen.getByText('收藏'), { dataTransfer: dragData('n1') });
    expect(props.onDropItem).not.toHaveBeenCalled();
  });
});

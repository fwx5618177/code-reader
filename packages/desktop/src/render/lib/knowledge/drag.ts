// ================================
// 知识库拖放：条目流中的条目可拖到侧边栏文件夹上移动；
// 侧边栏中的文件夹可拖到另一个文件夹（或「我的文件夹」根节点）上改变层级
// ================================

/** dataTransfer 中携带条目 ID 的数据类型 */
export const KNOWLEDGE_ITEM_DRAG_TYPE = 'application/x-knowledge-item';

/** dataTransfer 中携带文件夹 ID 的数据类型 */
export const KNOWLEDGE_FOLDER_DRAG_TYPE = 'application/x-knowledge-folder';

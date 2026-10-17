// ================================
// 插件 Worker 与宿主之间的消息协议
// 插件代码只在 Worker 中运行，所有能力都以 call 消息向宿主请求，由宿主做权限检查
// ================================

/** Worker 可调用的宿主方法 */
export const HOST_METHODS = [
  'commands.register',
  'editor.getContent',
  'editor.getSelection',
  'editor.getCursorPosition',
  'editor.setContent',
  'editor.replaceSelection',
  'editor.insertText',
  'editor.setCursorPosition',
  'editor.subscribeChange',
  'ui.showMessage',
  'ui.showInput',
  'ui.showQuickPick',
  'ui.showConfirm',
  'statusBar.set',
  'statusBar.clear',
  'storage.get',
  'storage.set',
  'storage.delete',
  'storage.keys',
] as const;

export type HostMethod = (typeof HOST_METHODS)[number];

type Outcome = { ok: true; value: unknown } | { ok: false; error: string };

/** 宿主 → Worker */
export type HostMessage =
  | { type: 'activate'; code: string }
  | ({ type: 'result'; id: number } & Outcome)
  | { type: 'runCommand'; id: number; command: string; args: unknown[] }
  | { type: 'editorChanged' }
  | { type: 'deactivate' };

/** Worker → 宿主 */
export type WorkerMessage =
  | { type: 'call'; id: number; method: HostMethod; args: unknown[] }
  | { type: 'activated' }
  | { type: 'activateFailed'; error: string }
  | ({ type: 'commandResult'; id: number } & Outcome)
  | { type: 'deactivated' };

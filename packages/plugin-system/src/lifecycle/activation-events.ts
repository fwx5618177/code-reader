// ================================
// 激活事件：插件在什么时机被激活
// - onStartup：应用启动（manifest 未声明 activationEvents 时的默认值）
// - onCommand:<命令 ID>：首次执行该命令时（执行插件声明的命令时总会先激活插件，此事件可省略）
// - onLanguage:<语言 ID>：首次打开该语言的文档时（如 onLanguage:markdown、onLanguage:latex）
// - onView:<视图 ID>：首次显示该视图时
// ================================

export const ACTIVATION_EVENT_KINDS = ['onStartup', 'onCommand', 'onLanguage', 'onView'] as const;

export type ActivationEventKind = (typeof ACTIVATION_EVENT_KINDS)[number];

export interface ParsedActivationEvent {
  kind: ActivationEventKind;
  /** onStartup 之外的事件参数 */
  argument?: string;
}

/** 未声明 activationEvents 时的默认值：启动即激活 */
export const DEFAULT_ACTIVATION_EVENTS: readonly string[] = ['onStartup'];

const ARGUMENT = /^[A-Za-z][\w.-]{0,63}$/;

/**
 * 解析激活事件字符串；格式不合法时返回 null
 */
export function parseActivationEvent(event: string): ParsedActivationEvent | null {
  if (event === 'onStartup') return { kind: 'onStartup' };
  const separator = event.indexOf(':');
  if (separator === -1) return null;
  const kind = event.slice(0, separator);
  const argument = event.slice(separator + 1);
  if (kind === 'onStartup' || !(ACTIVATION_EVENT_KINDS as readonly string[]).includes(kind) || !ARGUMENT.test(argument)) {
    return null;
  }
  return { kind: kind as ActivationEventKind, argument };
}

export function activationEvent(kind: Exclude<ActivationEventKind, 'onStartup'>, argument: string): string {
  return `${kind}:${argument}`;
}

/**
 * 已发生的事件中是否有插件声明的激活事件
 * @param declared manifest.activationEvents；未声明时按 DEFAULT_ACTIVATION_EVENTS
 */
export function shouldActivate(declared: readonly string[] | undefined, fired: ReadonlySet<string>): boolean {
  return (declared ?? DEFAULT_ACTIVATION_EVENTS).some((event) => fired.has(event));
}

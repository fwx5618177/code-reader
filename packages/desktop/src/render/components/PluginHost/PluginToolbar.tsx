// ================================
// 插件工具按钮：编辑器标签栏右侧，来自 manifest.contributes.toolbar（点击执行插件命令）
// ================================

import React, { useSyncExternalStore } from 'react';
import {
  Bookmark,
  Calendar,
  ChartBar,
  Clock,
  Hash,
  Link,
  List,
  Puzzle,
  Quote,
  Sigma,
  Sparkles,
  SquareCheck,
  Star,
  Tag,
  Type,
  Wand,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ToolbarIconName } from '../../lib/plugins/manifest';
import { pluginService } from '../../services/pluginService';

const ICONS: Record<ToolbarIconName, LucideIcon> = {
  calendar: Calendar,
  clock: Clock,
  chart: ChartBar,
  hash: Hash,
  type: Type,
  list: List,
  check: SquareCheck,
  star: Star,
  bookmark: Bookmark,
  tag: Tag,
  zap: Zap,
  wand: Wand,
  sparkles: Sparkles,
  quote: Quote,
  link: Link,
  sigma: Sigma,
  puzzle: Puzzle,
};

const getToolbar = () => pluginService.getSnapshot().contributions.toolbar;

const PluginToolbar: React.FC<{ buttonClassName: string }> = ({ buttonClassName }) => {
  const items = useSyncExternalStore(pluginService.subscribe, getToolbar);
  return (
    <>
      {items.map((item) => {
        const Icon = ICONS[item.icon as ToolbarIconName] ?? Puzzle;
        return (
          <button
            key={`${item.pluginId}.${item.commandId}`}
            type="button"
            className={buttonClassName}
            title={`${item.tooltip}（${item.pluginName}）`}
            aria-label={item.tooltip}
            onClick={() => pluginService.runCommand(item.pluginId, item.commandId)}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </>
  );
};

export default PluginToolbar;

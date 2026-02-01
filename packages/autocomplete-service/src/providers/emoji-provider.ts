// ================================
// @code-reader/autocomplete-service
// Emoji 补全提供者
// 提供 Emoji 表情符号的补全
// ================================

import { BaseProvider } from './base-provider';
import type { CompletionContext, CompletionItem, CompletionSourceType } from '../types';

// ================================
// Emoji 数据
// ================================

/** Emoji 定义 */
interface EmojiDefinition {
  /** 短代码 */
  shortcode: string;
  /** Emoji 字符 */
  emoji: string;
  /** 描述 */
  description: string;
  /** 分类 */
  category: string;
  /** 别名列表 */
  aliases?: string[];
}

/** 常用 Emoji 列表 */
const COMMON_EMOJIS: EmojiDefinition[] = [
  // 表情
  { shortcode: 'smile', emoji: '😊', description: '微笑', category: 'face', aliases: ['happy'] },
  { shortcode: 'grinning', emoji: '😀', description: '露齿笑', category: 'face' },
  { shortcode: 'joy', emoji: '😂', description: '喜极而泣', category: 'face', aliases: ['laugh', 'lol'] },
  { shortcode: 'rofl', emoji: '🤣', description: '笑到打滚', category: 'face' },
  { shortcode: 'wink', emoji: '😉', description: '眨眼', category: 'face' },
  { shortcode: 'blush', emoji: '😊', description: '脸红', category: 'face' },
  { shortcode: 'heart_eyes', emoji: '😍', description: '花痴', category: 'face', aliases: ['love'] },
  { shortcode: 'kissing_heart', emoji: '😘', description: '飞吻', category: 'face' },
  { shortcode: 'thinking', emoji: '🤔', description: '思考', category: 'face', aliases: ['hmm'] },
  { shortcode: 'sunglasses', emoji: '😎', description: '墨镜', category: 'face', aliases: ['cool'] },
  { shortcode: 'smirk', emoji: '😏', description: '得意', category: 'face' },
  { shortcode: 'unamused', emoji: '😒', description: '不高兴', category: 'face' },
  { shortcode: 'disappointed', emoji: '😞', description: '失望', category: 'face', aliases: ['sad'] },
  { shortcode: 'worried', emoji: '😟', description: '担心', category: 'face' },
  { shortcode: 'cry', emoji: '😢', description: '哭泣', category: 'face' },
  { shortcode: 'sob', emoji: '😭', description: '大哭', category: 'face' },
  { shortcode: 'angry', emoji: '😠', description: '生气', category: 'face', aliases: ['mad'] },
  { shortcode: 'rage', emoji: '😡', description: '愤怒', category: 'face' },
  { shortcode: 'scream', emoji: '😱', description: '惊恐', category: 'face', aliases: ['scared'] },
  { shortcode: 'flushed', emoji: '😳', description: '脸红', category: 'face' },
  { shortcode: 'sleeping', emoji: '😴', description: '睡觉', category: 'face', aliases: ['zzz'] },
  { shortcode: 'mask', emoji: '😷', description: '口罩', category: 'face' },
  { shortcode: 'nerd', emoji: '🤓', description: '书呆子', category: 'face' },
  { shortcode: 'clown', emoji: '🤡', description: '小丑', category: 'face' },
  { shortcode: 'exploding_head', emoji: '🤯', description: '爆炸头', category: 'face', aliases: ['mindblown'] },

  // 手势
  { shortcode: 'thumbsup', emoji: '👍', description: '点赞', category: 'gesture', aliases: ['+1', 'like'] },
  { shortcode: 'thumbsdown', emoji: '👎', description: '差评', category: 'gesture', aliases: ['-1', 'dislike'] },
  { shortcode: 'clap', emoji: '👏', description: '鼓掌', category: 'gesture', aliases: ['applause'] },
  { shortcode: 'wave', emoji: '👋', description: '挥手', category: 'gesture', aliases: ['hi', 'bye'] },
  { shortcode: 'ok_hand', emoji: '👌', description: 'OK', category: 'gesture' },
  { shortcode: 'v', emoji: '✌️', description: '胜利', category: 'gesture', aliases: ['victory', 'peace'] },
  { shortcode: 'raised_hands', emoji: '🙌', description: '举手', category: 'gesture', aliases: ['hooray'] },
  { shortcode: 'pray', emoji: '🙏', description: '祈祷', category: 'gesture', aliases: ['please', 'thanks'] },
  { shortcode: 'muscle', emoji: '💪', description: '肌肉', category: 'gesture', aliases: ['strong', 'flex'] },
  { shortcode: 'point_up', emoji: '☝️', description: '向上指', category: 'gesture' },
  { shortcode: 'point_down', emoji: '👇', description: '向下指', category: 'gesture' },
  { shortcode: 'point_left', emoji: '👈', description: '向左指', category: 'gesture' },
  { shortcode: 'point_right', emoji: '👉', description: '向右指', category: 'gesture' },
  { shortcode: 'fist', emoji: '✊', description: '拳头', category: 'gesture' },
  { shortcode: 'punch', emoji: '👊', description: '出拳', category: 'gesture' },
  { shortcode: 'handshake', emoji: '🤝', description: '握手', category: 'gesture' },

  // 心形
  { shortcode: 'heart', emoji: '❤️', description: '红心', category: 'symbol', aliases: ['love', 'red_heart'] },
  { shortcode: 'orange_heart', emoji: '🧡', description: '橙心', category: 'symbol' },
  { shortcode: 'yellow_heart', emoji: '💛', description: '黄心', category: 'symbol' },
  { shortcode: 'green_heart', emoji: '💚', description: '绿心', category: 'symbol' },
  { shortcode: 'blue_heart', emoji: '💙', description: '蓝心', category: 'symbol' },
  { shortcode: 'purple_heart', emoji: '💜', description: '紫心', category: 'symbol' },
  { shortcode: 'black_heart', emoji: '🖤', description: '黑心', category: 'symbol' },
  { shortcode: 'white_heart', emoji: '🤍', description: '白心', category: 'symbol' },
  { shortcode: 'broken_heart', emoji: '💔', description: '心碎', category: 'symbol' },
  { shortcode: 'sparkling_heart', emoji: '💖', description: '闪亮心', category: 'symbol' },
  { shortcode: 'heartbeat', emoji: '💓', description: '心跳', category: 'symbol' },

  // 符号
  { shortcode: 'star', emoji: '⭐', description: '星星', category: 'symbol' },
  { shortcode: 'sparkles', emoji: '✨', description: '闪烁', category: 'symbol' },
  { shortcode: 'fire', emoji: '🔥', description: '火焰', category: 'symbol', aliases: ['hot', 'lit'] },
  { shortcode: 'boom', emoji: '💥', description: '爆炸', category: 'symbol', aliases: ['explosion'] },
  { shortcode: 'zap', emoji: '⚡', description: '闪电', category: 'symbol', aliases: ['lightning'] },
  { shortcode: 'sun', emoji: '☀️', description: '太阳', category: 'nature' },
  { shortcode: 'moon', emoji: '🌙', description: '月亮', category: 'nature' },
  { shortcode: 'rainbow', emoji: '🌈', description: '彩虹', category: 'nature' },
  { shortcode: 'cloud', emoji: '☁️', description: '云朵', category: 'nature' },
  { shortcode: 'snowflake', emoji: '❄️', description: '雪花', category: 'nature' },

  // 物品
  { shortcode: 'rocket', emoji: '🚀', description: '火箭', category: 'object', aliases: ['launch'] },
  { shortcode: 'airplane', emoji: '✈️', description: '飞机', category: 'object' },
  { shortcode: 'car', emoji: '🚗', description: '汽车', category: 'object' },
  { shortcode: 'gift', emoji: '🎁', description: '礼物', category: 'object', aliases: ['present'] },
  { shortcode: 'trophy', emoji: '🏆', description: '奖杯', category: 'object', aliases: ['award', 'winner'] },
  { shortcode: 'medal', emoji: '🏅', description: '奖牌', category: 'object' },
  { shortcode: 'crown', emoji: '👑', description: '皇冠', category: 'object', aliases: ['king', 'queen'] },
  { shortcode: 'gem', emoji: '💎', description: '钻石', category: 'object', aliases: ['diamond'] },
  { shortcode: 'bulb', emoji: '💡', description: '灯泡', category: 'object', aliases: ['idea'] },
  { shortcode: 'book', emoji: '📖', description: '书籍', category: 'object' },
  { shortcode: 'pencil', emoji: '✏️', description: '铅笔', category: 'object' },
  { shortcode: 'memo', emoji: '📝', description: '备忘录', category: 'object', aliases: ['note'] },
  { shortcode: 'computer', emoji: '💻', description: '电脑', category: 'object', aliases: ['laptop'] },
  { shortcode: 'phone', emoji: '📱', description: '手机', category: 'object' },
  { shortcode: 'camera', emoji: '📷', description: '相机', category: 'object' },
  { shortcode: 'key', emoji: '🔑', description: '钥匙', category: 'object' },
  { shortcode: 'lock', emoji: '🔒', description: '锁', category: 'object' },
  { shortcode: 'unlock', emoji: '🔓', description: '开锁', category: 'object' },
  { shortcode: 'bell', emoji: '🔔', description: '铃铛', category: 'object' },
  { shortcode: 'magnifying_glass', emoji: '🔍', description: '放大镜', category: 'object', aliases: ['search'] },

  // 食物
  { shortcode: 'coffee', emoji: '☕', description: '咖啡', category: 'food' },
  { shortcode: 'tea', emoji: '🍵', description: '茶', category: 'food' },
  { shortcode: 'beer', emoji: '🍺', description: '啤酒', category: 'food' },
  { shortcode: 'cake', emoji: '🎂', description: '蛋糕', category: 'food', aliases: ['birthday'] },
  { shortcode: 'pizza', emoji: '🍕', description: '披萨', category: 'food' },
  { shortcode: 'hamburger', emoji: '🍔', description: '汉堡', category: 'food' },
  { shortcode: 'fries', emoji: '🍟', description: '薯条', category: 'food' },
  { shortcode: 'apple', emoji: '🍎', description: '苹果', category: 'food' },

  // 动物
  { shortcode: 'dog', emoji: '🐶', description: '狗', category: 'animal' },
  { shortcode: 'cat', emoji: '🐱', description: '猫', category: 'animal' },
  { shortcode: 'panda', emoji: '🐼', description: '熊猫', category: 'animal' },
  { shortcode: 'unicorn', emoji: '🦄', description: '独角兽', category: 'animal' },
  { shortcode: 'butterfly', emoji: '🦋', description: '蝴蝶', category: 'animal' },
  { shortcode: 'bee', emoji: '🐝', description: '蜜蜂', category: 'animal' },
  { shortcode: 'bug', emoji: '🐛', description: '虫子', category: 'animal' },

  // 状态和标记
  { shortcode: 'check', emoji: '✅', description: '对勾', category: 'mark', aliases: ['done', 'yes'] },
  { shortcode: 'x', emoji: '❌', description: '叉号', category: 'mark', aliases: ['no', 'wrong'] },
  { shortcode: 'warning', emoji: '⚠️', description: '警告', category: 'mark' },
  { shortcode: 'question', emoji: '❓', description: '问号', category: 'mark' },
  { shortcode: 'exclamation', emoji: '❗', description: '感叹号', category: 'mark', aliases: ['important'] },
  { shortcode: 'info', emoji: 'ℹ️', description: '信息', category: 'mark' },
  { shortcode: 'pin', emoji: '📌', description: '图钉', category: 'mark' },
  { shortcode: 'link', emoji: '🔗', description: '链接', category: 'mark' },
  { shortcode: 'chart', emoji: '📊', description: '图表', category: 'mark', aliases: ['graph'] },
  { shortcode: 'calendar', emoji: '📅', description: '日历', category: 'mark', aliases: ['date'] },
  { shortcode: 'clock', emoji: '🕐', description: '时钟', category: 'mark', aliases: ['time'] },
  { shortcode: 'hourglass', emoji: '⏳', description: '沙漏', category: 'mark', aliases: ['loading'] },

  // 箭头
  { shortcode: 'arrow_up', emoji: '⬆️', description: '向上箭头', category: 'arrow' },
  { shortcode: 'arrow_down', emoji: '⬇️', description: '向下箭头', category: 'arrow' },
  { shortcode: 'arrow_left', emoji: '⬅️', description: '向左箭头', category: 'arrow' },
  { shortcode: 'arrow_right', emoji: '➡️', description: '向右箭头', category: 'arrow' },
  { shortcode: 'arrow_forward', emoji: '▶️', description: '播放', category: 'arrow', aliases: ['play'] },
  { shortcode: 'arrow_backward', emoji: '◀️', description: '后退', category: 'arrow' },

  // 数字
  { shortcode: 'one', emoji: '1️⃣', description: '数字1', category: 'number' },
  { shortcode: 'two', emoji: '2️⃣', description: '数字2', category: 'number' },
  { shortcode: 'three', emoji: '3️⃣', description: '数字3', category: 'number' },
  { shortcode: 'four', emoji: '4️⃣', description: '数字4', category: 'number' },
  { shortcode: 'five', emoji: '5️⃣', description: '数字5', category: 'number' },
  { shortcode: '100', emoji: '💯', description: '满分', category: 'number', aliases: ['perfect', 'hundred'] },
];

// ================================
// Emoji 提供者类
// ================================

/**
 * Emoji 补全提供者
 * 提供 Emoji 表情符号的补全
 */
export class EmojiProvider extends BaseProvider {
  readonly name = 'emoji';
  readonly type: CompletionSourceType = 'emoji';

  /** Emoji 列表 */
  private emojis: EmojiDefinition[];

  constructor() {
    super(70, [':']);
    this.emojis = COMMON_EMOJIS;
  }

  /**
   * 获取补全项
   */
  getCompletions(context: CompletionContext): CompletionItem[] {
    const { query, textBefore } = context;

    // 检查是否在 : 后面输入
    const colonMatch = textBefore.match(/:([a-zA-Z0-9_+-]*)$/);
    if (!colonMatch && query.length === 0) {
      return [];
    }

    // 获取搜索词
    const searchTerm = colonMatch ? colonMatch[1] : query;
    const searchLower = searchTerm.toLowerCase();

    // 收集匹配的 Emoji
    const items: CompletionItem[] = [];

    for (const emoji of this.emojis) {
      const shortcodeLower = emoji.shortcode.toLowerCase();
      const descLower = emoji.description.toLowerCase();

      // 检查匹配
      let matched = false;
      let matchPriority = 50;

      // 短代码匹配
      if (shortcodeLower === searchLower) {
        matched = true;
        matchPriority = 100;
      } else if (shortcodeLower.startsWith(searchLower)) {
        matched = true;
        matchPriority = 90;
      } else if (shortcodeLower.includes(searchLower)) {
        matched = true;
        matchPriority = 70;
      }

      // 描述匹配
      if (!matched && descLower.includes(searchLower)) {
        matched = true;
        matchPriority = 60;
      }

      // 别名匹配
      if (!matched && emoji.aliases) {
        for (const alias of emoji.aliases) {
          if (alias.toLowerCase().includes(searchLower)) {
            matched = true;
            matchPriority = 65;
            break;
          }
        }
      }

      // 模糊匹配
      if (!matched && this.fuzzyMatch(searchLower, shortcodeLower)) {
        matched = true;
        matchPriority = 40;
      }

      if (matched) {
        items.push(
          this.createItem(`emoji-${emoji.shortcode}`, `${emoji.emoji} :${emoji.shortcode}:`, {
            insertText: emoji.emoji,
            detail: emoji.description,
            documentation: `${emoji.emoji} - ${emoji.description}\n分类: ${emoji.category}`,
            priority: matchPriority,
            filterText: `:${emoji.shortcode}:`,
            icon: emoji.emoji,
          })
        );
      }
    }

    // 排序并限制数量
    items.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return items.slice(0, 30);
  }

  /**
   * 是否应该激活
   */
  shouldActivate(context: CompletionContext): boolean {
    const { textBefore, triggerCharacter } = context;

    // 冒号触发
    if (triggerCharacter === ':') {
      return true;
    }

    // 检查是否在输入 :xxx
    if (textBefore.includes(':')) {
      const colonMatch = textBefore.match(/:([a-zA-Z0-9_+-]*)$/);
      return colonMatch !== null;
    }

    return false;
  }

  /**
   * 添加自定义 Emoji
   */
  addEmoji(emoji: EmojiDefinition): void {
    this.emojis.push(emoji);
  }

  /**
   * 添加多个自定义 Emoji
   */
  addEmojis(emojis: EmojiDefinition[]): void {
    this.emojis.push(...emojis);
  }

  /**
   * 移除 Emoji
   */
  removeEmoji(shortcode: string): void {
    const index = this.emojis.findIndex((e) => e.shortcode === shortcode);
    if (index !== -1) {
      this.emojis.splice(index, 1);
    }
  }

  /**
   * 按分类获取 Emoji
   */
  getByCategory(category: string): EmojiDefinition[] {
    return this.emojis.filter((e) => e.category === category);
  }

  /**
   * 获取所有分类
   */
  getCategories(): string[] {
    const categories = new Set<string>();
    for (const emoji of this.emojis) {
      categories.add(emoji.category);
    }
    return [...categories];
  }

  /**
   * 搜索 Emoji
   */
  search(query: string): EmojiDefinition[] {
    const queryLower = query.toLowerCase();
    return this.emojis.filter((emoji) => {
      if (emoji.shortcode.toLowerCase().includes(queryLower)) return true;
      if (emoji.description.toLowerCase().includes(queryLower)) return true;
      if (emoji.aliases?.some((a) => a.toLowerCase().includes(queryLower))) return true;
      return false;
    });
  }

  /**
   * 重置为默认 Emoji 列表
   */
  reset(): void {
    this.emojis = [...COMMON_EMOJIS];
  }
}

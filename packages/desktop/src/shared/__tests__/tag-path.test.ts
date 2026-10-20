// ================================
// 层级标签路径测试
// ================================

import { describe, expect, it } from 'vitest';
import {
  ancestorTagPaths,
  isTagPathWithin,
  normalizeTagPath,
  parentTagPath,
  rebaseTagPath,
  tagLeafName,
} from '../tag-path';
describe('tag-path', () => {
  it('规范化：去 #、统一全半角与空白、丢弃空级', () => {
    expect(normalizeTagPath(' #技术 / /前端 ')).toBe('技术/前端');
    expect(normalizeTagPath('##React　Hooks')).toBe('React Hooks');
    expect(normalizeTagPath('技术／前端')).toBe('技术/前端');
    expect(normalizeTagPath(' / ')).toBe('');
  });

  it('父路径、祖先与末级名称', () => {
    expect(parentTagPath('a/b/c')).toBe('a/b');
    expect(parentTagPath('a')).toBeNull();
    expect(ancestorTagPaths('a/b/c')).toEqual(['a/b', 'a']);
    expect(tagLeafName('a/b/c')).toBe('c');
    expect(tagLeafName('a')).toBe('a');
  });

  it('层级包含与改名后的新路径（同前缀但非子级的不算）', () => {
    expect(isTagPathWithin('a/b', 'a')).toBe(true);
    expect(isTagPathWithin('a', 'a')).toBe(true);
    expect(isTagPathWithin('ab', 'a')).toBe(false);
    expect(rebaseTagPath('a/b/c', 'a/b', 'x')).toBe('x/c');
    expect(rebaseTagPath('a/bc', 'a/b', 'x')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { HeightMap } from '../height-map';

function createMap(): HeightMap {
  const map = new HeightMap();
  map.setLayout([
    { id: 'a', startLine: 1, endLine: 5 },
    { id: 'b', startLine: 5, endLine: 7 },
    { id: 'c', startLine: 7, endLine: 17 },
  ]);
  return map;
}

describe('HeightMap', () => {
  it('未测量时不给出位置（不以估算代替实测）', () => {
    const map = createMap();
    expect(map.getPositionForLine(3)).toBeNull();
    expect(map.getLineForPosition(100)).toBeNull();
  });

  it('行 → 位置：取块的实测上沿，并在块内按行插值', () => {
    const map = createMap();
    map.applyMeasurements([
      { id: 'a', renderTop: 0, renderHeight: 80 },
      // 块间外边距（80~100）不属于任何块
      { id: 'b', renderTop: 100, renderHeight: 40 },
      { id: 'c', renderTop: 160, renderHeight: 500 },
    ]);
    expect(map.getPositionForLine(1)).toBe(0);
    expect(map.getPositionForLine(3)).toBe(40);
    expect(map.getPositionForLine(5)).toBe(100);
    expect(map.getPositionForLine(6.5)).toBe(130);
    expect(map.getPositionForLine(12)).toBe(410);
    // 超出最后一块的行（如 \end{document} 之后）落在最后一块底部
    expect(map.getPositionForLine(40)).toBe(660);
  });

  it('位置 → 行：与行 → 位置互逆，块间空隙归到上一块末尾', () => {
    const map = createMap();
    map.applyMeasurements([
      { id: 'a', renderTop: 0, renderHeight: 80 },
      { id: 'b', renderTop: 100, renderHeight: 40 },
      { id: 'c', renderTop: 160, renderHeight: 500 },
    ]);
    expect(map.getLineForPosition(40)).toBe(3);
    expect(map.getLineForPosition(90)).toBe(5);
    expect(map.getLineForPosition(410)).toBe(12);
    for (const line of [1, 2.5, 5, 6, 7, 9.25, 16]) {
      expect(map.getLineForPosition(map.getPositionForLine(line)!)).toBeCloseTo(line);
    }
  });

  it('编辑后更新行范围时保留未变块的实测值，新块在测量前不参与查询', () => {
    const map = createMap();
    map.applyMeasurements([
      { id: 'a', renderTop: 0, renderHeight: 80 },
      { id: 'b', renderTop: 100, renderHeight: 40 },
      { id: 'c', renderTop: 160, renderHeight: 500 },
    ]);
    // 在 a 与 b 之间插入新块 n，b、c 的行号整体后移 3 行
    map.setLayout([
      { id: 'a', startLine: 1, endLine: 5 },
      { id: 'n', startLine: 5, endLine: 8 },
      { id: 'b', startLine: 8, endLine: 10 },
      { id: 'c', startLine: 10, endLine: 20 },
    ]);
    expect(map.getPositionForLine(8)).toBe(100);
    expect(map.getPositionForLine(6)).toBeNull();
    expect(map.getLineForPosition(130)).toBeCloseTo(9.5);

    map.applyMeasurements([{ id: 'n', renderTop: 90, renderHeight: 30 }]);
    expect(map.getPositionForLine(6)).toBe(100);
  });
});

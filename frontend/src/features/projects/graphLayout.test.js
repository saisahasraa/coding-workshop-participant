import { describe, expect, it } from 'vitest';
import { layout, NODE_H, NODE_W } from './graphLayout';

describe('dependency graph layout', () => {
  it('puts each node in the column of its depth and stacks nodes within a column', () => {
    const { positions, width, height } = layout([
      { key: 'A-1', depth: 0 }, { key: 'A-2', depth: 1 }, { key: 'A-3', depth: 1 }, { key: 'A-4', depth: 2 },
    ]);
    expect(positions['A-1'].x).toBe(0);
    expect(positions['A-2'].x).toBe(positions['A-3'].x);
    expect(positions['A-4'].x).toBeGreaterThan(positions['A-2'].x);
    expect(positions['A-3'].y).toBeGreaterThan(positions['A-2'].y);
    expect(width).toBeGreaterThan(3 * NODE_W);
    expect(height).toBeGreaterThan(2 * NODE_H); // the two-node column
  });

  it('copes with nothing to draw', () => {
    expect(layout([]).positions).toEqual({});
  });
});

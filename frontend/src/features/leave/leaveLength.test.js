import { describe, expect, it } from 'vitest';
import leaveLength from './leaveLength';

describe('leaveLength', () => {
  it.each([
    ['2026-03-09', '2026-03-09', 1],
    ['2026-03-09', '2026-03-11', 3],
    ['2026-02-27', '2026-03-02', 4], // across a month end
    ['2025-12-30', '2026-01-02', 4], // across a year end
  ])('%s to %s is %i day(s)', (start_date, end_date, days) => {
    expect(leaveLength({ start_date, end_date })).toBe(days);
  });
});

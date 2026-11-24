import { describe, expect, it } from 'vitest';
import { daysUntil, dueInWords } from './due';
import { avatarColor, initials } from './people';

const TODAY = new Date(2026, 2, 10); // 10 March 2026

describe('due dates in words', () => {
  it('counts whole days either side of today', () => {
    expect(daysUntil('2026-03-10', TODAY)).toBe(0);
    expect(daysUntil('2026-03-13', TODAY)).toBe(3);
    expect(daysUntil('2026-03-01', TODAY)).toBe(-9);
  });

  it.each([
    ['2026-03-09', false, '1 day overdue', 'error'],
    ['2026-03-01', false, '9 days overdue', 'error'],
    ['2026-03-10', false, 'Due today', 'warning'],
    ['2026-03-11', false, 'Due tomorrow', 'warning'],
    ['2026-03-17', false, 'Due in 7 days', null],
  ])('%s -> %s', (date, done, text, tone) => {
    expect(dueInWords(date, done, TODAY)).toEqual({ text, tone });
  });

  it('leaves far-off, missing and finished dates alone', () => {
    expect(dueInWords('2026-06-01', false, TODAY)).toBeNull();
    expect(dueInWords(null, false, TODAY)).toBeNull();
    expect(dueInWords('2026-03-01', true, TODAY)).toBeNull();
  });
});

describe('people helpers', () => {
  it('builds initials and a stable colour', () => {
    expect(initials('Dan Okafor')).toBe('DO');
    expect(initials('Sai Sahasra Patil')).toBe('SS');
    expect(initials('')).toBe('?');
    expect(avatarColor('Dan Okafor')).toBe(avatarColor('Dan Okafor'));
    expect(avatarColor('Dan Okafor')).toMatch(/^hsl\(/);
  });
});

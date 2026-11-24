import { describe, expect, it } from 'vitest';
import { PROJECT_KEY_RE, suggestKey } from './keys';

describe('suggestKey', () => {
  it.each([
    ['Engineering', 'ENG'],
    ['Website relaunch', 'WEBR'],
    ['Payments platform version 2', 'PPV2'],
    ['site reliability engineering', 'SRE'],
    ['  ', ''],
    ['2026 roadmap', 'ROA'],
  ])('%s -> %s', (name, key) => {
    expect(suggestKey(name)).toBe(key);
  });

  it('produces valid keys for typical names', () => {
    ['DevOps', 'Data warehouse migration', 'Mobile app MVP'].forEach((name) => {
      expect(suggestKey(name)).toMatch(PROJECT_KEY_RE);
    });
  });
});

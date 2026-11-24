import { describe, expect, it } from 'vitest';
import { changeLines } from './changeLines';
import { describeValue, fromDraft, toDraft } from './settingEditors';

describe('setting editors', () => {
  it('round-trips every kind of value', () => {
    expect(fromDraft({ kind: 'int' }, '12')).toBe(12);
    expect(fromDraft({ kind: 'int' }, '')).toBeNull();
    expect(fromDraft({ kind: 'int_list' }, '1, 2,3,')).toEqual([1, 2, 3]);
    expect(fromDraft({ kind: 'str_list' }, 'a, b ,,c')).toEqual(['a', 'b', 'c']);
    expect(fromDraft({ kind: 'str' }, 'Name')).toBe('Name');
    expect(toDraft({ kind: 'int_list' }, [1, 2])).toBe('1, 2');
    expect(toDraft({ kind: 'bool' }, 1)).toBe(true);
    expect(toDraft({ kind: 'int' }, 7)).toBe('7');
  });

  it('describes values for people', () => {
    expect(describeValue(['a', 'b'])).toBe('a, b');
    expect(describeValue('INFO')).toBe('"INFO"');
    expect(describeValue(10)).toBe('10');
  });

  it('lists what an audit entry changed', () => {
    expect(changeLines({ changes: { value: { from: 1, to: 2 } } })).toEqual([['value', '1 → 2']]);
    expect(changeLines({ changes: { after: { key: 'WEB' } } })).toEqual([['key', '"WEB"']]);
    expect(changeLines({ changes: { before: { amount: '5' } } })).toEqual([['amount', '"5"']]);
    expect(changeLines({ changes: { note: 'plain' } })).toEqual([['note', '"plain"']]);
  });
});

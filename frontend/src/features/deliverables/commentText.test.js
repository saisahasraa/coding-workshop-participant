import { describe, expect, it } from 'vitest';
import { formatSize, insertAt, mentionedIds, mentionQuery, parseComment } from './commentText';

describe('comment markup', () => {
  it('finds the mention being typed before the caret', () => {
    expect(mentionQuery('hello @da', 9)).toEqual({ query: 'da', start: 6 });
    expect(mentionQuery('@', 1)).toEqual({ query: '', start: 0 });
    expect(mentionQuery('@Dan Ok', 7)).toEqual({ query: 'Dan Ok', start: 0 });
    expect(mentionQuery('mail me at a@b', 14)).toBeNull();           // an address, not a mention
    expect(mentionQuery('no trigger here', 5)).toBeNull();
  });

  it('inserts a piece at the caret without gluing it to words', () => {
    expect(insertAt('before after', 6, '[f](attachment:1)')).toEqual({ text: 'before [f](attachment:1) after', caret: 24 });
    expect(insertAt('beforeafter', 6, 'X').text).toBe('before X after');
    expect(insertAt('', 0, 'X')).toEqual({ text: 'X ', caret: 2 });
  });

  it('keeps only the mentions still in the text', () => {
    const picked = [{ id: 1, name: 'Dan Okafor' }, { id: 2, name: 'Erin Walsh' }];
    expect(mentionedIds('ping @Dan Okafor', picked)).toEqual([1]);
    expect(mentionedIds('nobody', picked)).toEqual([]);
  });

  it('splits a comment into text, mentions and files', () => {
    const parts = parseComment('Hi @Dan Okafor see [plan v2.pdf](attachment:7) now', [{ id: 1, name: 'Dan Okafor' }]);
    expect(parts).toEqual([
      { type: 'text', value: 'Hi ' }, { type: 'mention', value: '@Dan Okafor' }, { type: 'text', value: ' see ' },
      { type: 'file', name: 'plan v2.pdf', id: 7 }, { type: 'text', value: ' now' },
    ]);
    expect(parseComment('@Dan Okafor', [])).toEqual([{ type: 'text', value: '@Dan Okafor' }]);   // not confirmed by the API
    expect(parseComment('', [])).toEqual([]);
  });

  it('formats sizes', () => {
    expect([formatSize(512), formatSize(2048), formatSize(5 * 1024 * 1024)]).toEqual(['512 B', '2 KB', '5.0 MB']);
  });
});

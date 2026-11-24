/** Reading and writing the small markup comments use: `@Name` mentions and `[name](attachment:ID)` files. */

const ATTACHMENT = /\[([^\]\n]+)\]\(attachment:(\d+)\)/g;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The `@query` being typed just before the caret, or null. */
export function mentionQuery(text, caret) {
  const match = /(^|\s)@([\p{L}\p{N} .'-]{0,40})$/u.exec(text.slice(0, caret));
  return match ? { query: match[2], start: caret - match[2].length - 1 } : null;
}

/** Insert `piece` into `text` at `caret`, padding with spaces so it never glues onto a word. */
export function insertAt(text, caret, piece) {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = /^\s/.test(after) ? '' : ' '; // also at the very end, so typing can continue
  const inserted = `${lead}${piece}${trail}`;
  return { text: before + inserted + after, caret: before.length + inserted.length };
}

/** Ids of the picked people whose `@Name` is still in the text. */
export const mentionedIds = (text, picked) => picked.filter((p) => text.includes(`@${p.name}`)).map((p) => p.id);

/**
 * Split a comment into parts to render: `{type: 'text'|'mention'|'file', ...}`.
 * @param {string} text
 * @param {{id: number, name: string}[]} mentions People the API says were mentioned
 */
export function parseComment(text, mentions = []) {
  const names = mentions.map((m) => escape(`@${m.name}`)).sort((a, b) => b.length - a.length);
  const pattern = new RegExp([ATTACHMENT.source, ...names].join('|'), 'g');
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) });
    if (match[2]) parts.push({ type: 'file', name: match[1], id: Number(match[2]) });
    else parts.push({ type: 'mention', value: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

/** `2048` -> `2 KB`. */
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

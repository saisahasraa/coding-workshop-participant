/** Project key helpers (keys look like ENG, SRE, DEVOPS: 3-6 chars, letter first). */

export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{2,5}$/;

/**
 * Suggest a key from a project name: initials for 3+ words ("Payments Platform Version 2" -> PPV2),
 * otherwise the first word's leading letters ("Engineering" -> ENG, "Website relaunch" -> WEBR).
 * @param {string} name
 * @returns {string}
 */
export function suggestKey(name) {
  const words = (name || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const lettered = words.filter((w) => /^[A-Z]/.test(w));
  if (!lettered.length) return '';
  let key;
  if (words.length >= 3) key = words.map((w) => w[0]).join('').replace(/^[0-9]+/, '');
  else if (lettered.length === 2) key = lettered[0].slice(0, 3) + lettered[1][0];
  else key = lettered[0].slice(0, 3);
  return key.slice(0, 6);
}

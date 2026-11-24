/** Helpers for showing people. */

/** `Dan Okafor` -> `DO`. */
export const initials = (name) => (name || '?').split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();

const HUES = [231, 262, 205, 165, 20, 335, 285, 190];

/** A stable colour per person, so the same avatar looks the same everywhere. */
export function avatarColor(name) {
  let hash = 0;
  for (const char of name || '') hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return `hsl(${HUES[hash % HUES.length]} 60% 30%)`; // dark enough for white initials (WCAG AA)
}

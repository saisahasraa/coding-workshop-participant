/** Turning setting values into text for an input, and back. Validation limits stay on the server. */

export const isList = (kind) => kind === 'int_list' || kind === 'str_list';

/** Text shown in the input for a stored value. */
export function toDraft(setting, value) {
  if (isList(setting.kind)) return value.join(', ');
  return setting.kind === 'bool' ? Boolean(value) : String(value);
}

/** Value sent to the API for the text in the input (the server validates it). */
export function fromDraft(setting, draft) {
  if (setting.kind === 'int') return draft === '' ? null : Number(draft);
  if (setting.kind === 'int_list') return draft.split(',').map((v) => v.trim()).filter(Boolean).map(Number);
  if (setting.kind === 'str_list') return draft.split(',').map((v) => v.trim()).filter(Boolean);
  return draft;
}

/** Readable form of a value, for "default" and history lines. */
export const describeValue = (value) => (Array.isArray(value) ? value.join(', ') : JSON.stringify(value));

/** Group heading for a settings prefix. */
export const GROUP_TITLES = {
  app: 'Application', logging: 'Logging', db: 'Database', api: 'API', auth: 'Sign-in', projects: 'Projects',
  capacity: 'Capacity', budget: 'Budget', health: 'Project health', leaves: 'Leave', dashboard: 'Dashboard', search: 'Search',
};

import { describeValue } from './settingEditors';

/** The changed fields of an entry as `[field, text]` lines. */
export function changeLines(entry) {
  const { changes } = entry;
  const snapshot = changes.after || changes.before;
  if (snapshot) return Object.entries(snapshot).map(([field, value]) => [field, describeValue(value)]);
  return Object.entries(changes).map(([field, change]) => (
    change && typeof change === 'object' && 'to' in change
      ? [field, `${describeValue(change.from)} → ${describeValue(change.to)}`]
      : [field, describeValue(change)]
  ));
}

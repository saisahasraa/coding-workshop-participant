import { formatDate, toOptions } from '../../utils/format';

/**
 * Form fields for a deliverable (the project is fixed by the caller).
 * @param {object} meta `GET /meta` payload
 * @param {object} lookups `{assignees}` options
 * @param {{start?: ?string, end?: ?string}} [projectDates] The due date must fall within these
 */
export default function deliverableFields(meta, lookups, projectDates = {}) {
  const { start, end } = projectDates;
  let dueHelp;
  if (start && end) dueHelp = `Within the project: ${formatDate(start)} – ${formatDate(end)}`;
  else if (end) dueHelp = `On or before the project end: ${formatDate(end)}`;
  else if (start) dueHelp = `On or after the project start: ${formatDate(start)}`;
  return [
    { name: 'name', label: 'Name', required: true },
    { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'acceptance_criteria', label: 'Acceptance criteria', type: 'textarea', helperText: 'What must be true for this to be done?' },
    { name: 'owner_id', label: 'Owner', type: 'select', numeric: true, options: lookups.assignees || [] },
    {
      name: 'status', label: 'Status', type: 'select', required: true, defaultValue: 'not_started',
      options: toOptions((meta?.deliverable_statuses || []).map((s) => s.value)),
    },
    { name: 'priority', label: 'Priority', type: 'select', required: true, defaultValue: 'medium', options: toOptions(meta?.priorities) },
    { name: 'due_date', label: 'Due date', type: 'date', min: start || undefined, max: end || undefined, helperText: dueHelp },
    { name: 'estimated_hours', label: 'Estimated hours', type: 'number', min: 0, step: 'any' },
    {
      name: 'progress_pct', label: 'Progress (%)', type: 'number', min: 0, max: 100, step: 1, defaultValue: 0,
      helperText: 'Completing a deliverable sets progress to 100%.',
    },
  ];
}

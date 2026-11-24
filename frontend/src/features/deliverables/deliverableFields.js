import { formatDate, toOptions } from '../../utils/format';

/**
 * Form fields for a deliverable. The project is fixed by the caller unless `pickProject` is set.
 * @param {object} meta `GET /meta` payload
 * @param {object} lookups `{assignees, openProjects}` options
 * @param {{start?: ?string, end?: ?string}} [projectDates] The due date must fall within these
 * @param {boolean} [pickProject] Ask which project it belongs to (creating from the all-deliverables list)
 */
export default function deliverableFields(meta, lookups, projectDates = {}, pickProject = false) {
  const { start, end } = projectDates;
  let dueHelp;
  if (start && end) dueHelp = `Within the project: ${formatDate(start)} – ${formatDate(end)}`;
  else if (end) dueHelp = `On or before the project end: ${formatDate(end)}`;
  else if (start) dueHelp = `On or after the project start: ${formatDate(start)}`;
  return [
    ...(pickProject ? [{
      name: 'project_id', label: 'Project', type: 'select', numeric: true, required: true, wide: true, section: 'Basics',
      options: lookups.openProjects || [], helperText: 'Projects that are still open and that you may add work to.',
    }] : []),
    { name: 'name', label: 'Name', required: true, wide: true, section: 'Basics' },
    { name: 'description', label: 'Description', type: 'textarea', section: 'Basics' },
    { name: 'acceptance_criteria', label: 'Acceptance criteria', type: 'textarea', section: 'Basics', helperText: 'What must be true for this to be done?' },
    { name: 'owner_id', label: 'Assignee', type: 'select', numeric: true, person: true, section: 'People and status', options: lookups.assignees || [] },
    { name: 'priority', label: 'Priority', type: 'select', required: true, defaultValue: 'medium', section: 'People and status', options: toOptions(meta?.priorities) },
    {
      name: 'status', label: 'Status', type: 'select', required: true, defaultValue: 'not_started', section: 'People and status',
      options: toOptions((meta?.deliverable_statuses || []).map((s) => s.value)),
    },
    {
      name: 'progress_pct', label: 'Progress', type: 'number', min: 0, max: 100, step: 1, defaultValue: 0, suffix: '%', section: 'People and status',
      helperText: 'Completing a deliverable sets progress to 100%.',
    },
    { name: 'due_date', label: 'Due date', type: 'date', section: 'Plan', min: start || undefined, max: end || undefined, helperText: dueHelp },
    { name: 'estimated_hours', label: 'Estimate', type: 'number', min: 0, step: 'any', suffix: 'hours', section: 'Plan', helperText: 'Reserved on the assignee until the due date.' },
  ];
}

import { toOptions } from '../../utils/format';
import { suggestKey } from '../../utils/keys';

const ACCESS_OPTIONS = [
  { value: 'inherit', label: 'Organization default' },
  { value: 'everyone', label: 'Everyone except viewers' },
  { value: 'members', label: 'Project members only' },
];

/**
 * Form fields for a project.
 * @param {object} meta `GET /meta` payload
 * @param {object} lookups `{departments, managers}` options
 * @param {boolean} canAssignManager Only admins may choose another manager
 */
export default function projectFields(meta, lookups, canAssignManager) {
  const fields = [
    { name: 'name', label: 'Name', required: true, section: 'Basics' },
    {
      name: 'key',
      label: 'Project key',
      section: 'Basics',
      required: true,
      pattern: '^[A-Z][A-Z0-9]{2,5}$',
      patternMessage: '3-6 letters or digits, starting with a letter',
      helperText: 'Prefix for deliverable keys, e.g. ENG → ENG-1. Cannot be changed later.',
      transform: (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6),
      deriveFrom: 'name',
      derive: suggestKey,
    },
    { name: 'description', label: 'Description', type: 'textarea', section: 'Basics' },
    { name: 'department_id', label: 'Department', type: 'select', numeric: true, required: true, options: lookups.departments || [], section: 'Ownership' },
  ];
  if (canAssignManager) {
    fields.push({ name: 'manager_id', label: 'Project manager', type: 'select', numeric: true, required: true, person: true, options: lookups.managers || [], section: 'Ownership' });
  }
  fields.push(
    { name: 'status', section: 'Plan', label: 'Status', type: 'select', required: true, options: toOptions(meta?.project_statuses), defaultValue: 'planning' },
    { name: 'priority', section: 'Plan', label: 'Priority', type: 'select', required: true, options: toOptions(meta?.priorities), defaultValue: 'medium' },
    { name: 'start_date', section: 'Plan', label: 'Start date', type: 'date' },
    { name: 'end_date', section: 'Plan', label: 'Target end date', type: 'date' },
    { name: 'planned_budget', section: 'Plan', label: 'Planned budget', type: 'number', min: 0, step: 'any', defaultValue: 0 },
    {
      name: 'visibility',
      section: 'Access',
      label: 'Who can see it',
      type: 'select',
      required: true,
      defaultValue: 'inherit',
      options: [
        { value: 'inherit', label: 'Organization default' },
        { value: 'everyone', label: 'Everyone' },
        { value: 'members', label: 'Project members only' },
      ],
      helperText: 'Admins and project managers always see every project.',
    },
    {
      name: 'edit_access', section: 'Access', label: 'Who can add and edit deliverables', type: 'select', required: true, defaultValue: 'inherit',
      options: ACCESS_OPTIONS, helperText: 'The assignee and reporter of a deliverable can always edit it.',
    },
    {
      name: 'comment_access', section: 'Access', label: 'Who can comment and attach files', type: 'select', required: true, defaultValue: 'inherit',
      options: ACCESS_OPTIONS, helperText: 'Viewers can never write.',
    },
  );
  return fields;
}

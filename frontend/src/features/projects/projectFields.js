import { toOptions } from '../../utils/format';
import { suggestKey } from '../../utils/keys';

/**
 * Form fields for a project.
 * @param {object} meta `GET /meta` payload
 * @param {object} lookups `{departments, managers}` options
 * @param {boolean} canAssignManager Only admins may choose another manager
 */
export default function projectFields(meta, lookups, canAssignManager) {
  const fields = [
    { name: 'name', label: 'Name', required: true },
    {
      name: 'key',
      label: 'Project key',
      required: true,
      pattern: '^[A-Z][A-Z0-9]{2,5}$',
      patternMessage: '3-6 letters or digits, starting with a letter',
      helperText: 'Prefix for deliverable keys, e.g. ENG → ENG-1. Cannot be changed later.',
      transform: (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6),
      deriveFrom: 'name',
      derive: suggestKey,
    },
    { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'department_id', label: 'Department', type: 'select', numeric: true, required: true, options: lookups.departments || [] },
  ];
  if (canAssignManager) {
    fields.push({ name: 'manager_id', label: 'Project manager', type: 'select', numeric: true, required: true, options: lookups.managers || [] });
  }
  fields.push(
    { name: 'status', label: 'Status', type: 'select', required: true, options: toOptions(meta?.project_statuses), defaultValue: 'planning' },
    { name: 'priority', label: 'Priority', type: 'select', required: true, options: toOptions(meta?.priorities), defaultValue: 'medium' },
    { name: 'start_date', label: 'Start date', type: 'date' },
    { name: 'end_date', label: 'Target end date', type: 'date' },
    { name: 'planned_budget', label: 'Planned budget', type: 'number', min: 0, step: 'any', defaultValue: 0 },
    {
      name: 'visibility',
      label: 'Visibility',
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
  );
  return fields;
}

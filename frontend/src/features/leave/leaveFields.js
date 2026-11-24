import { toOptions } from '../../utils/format';

/**
 * Form fields for planned leave.
 * @param {object} meta `GET /meta` payload (leave types come from the `leaves.types` setting)
 * @param {{value: number, label: string}[]|null} people Selectable people; `null` hides the field
 *   (people recording their own leave)
 */
export default function leaveFields(meta, people) {
  const types = toOptions(meta?.settings?.['leaves.types'] || ['vacation', 'sick', 'training', 'other']);
  return [
    ...(people ? [{ name: 'user_id', label: 'Person', type: 'select', numeric: true, required: true, options: people }] : []),
    { name: 'type', label: 'Type', type: 'select', required: true, options: types, defaultValue: types[0].value },
    { name: 'start_date', label: 'First day', type: 'date', required: true },
    { name: 'end_date', label: 'Last day', type: 'date', required: true, helperText: 'Weekends and non-working days are not counted.' },
    { name: 'note', label: 'Note', type: 'textarea' },
  ];
}

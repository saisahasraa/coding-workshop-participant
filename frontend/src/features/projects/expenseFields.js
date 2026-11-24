import { toOptions } from '../../utils/format';

/**
 * Form fields for an expense.
 * @param {string[]} categories Allowed categories (the `budget.expense_categories` setting)
 */
export default function expenseFields(categories) {
  const options = toOptions(categories);
  return [
    { name: 'amount', label: 'Amount', type: 'number', required: true, min: 0.01, step: 'any' },
    { name: 'category', label: 'Category', type: 'select', required: true, options, defaultValue: options[0]?.value },
    { name: 'spent_on', label: 'Date', type: 'date', required: true, defaultValue: new Date().toISOString().slice(0, 10) },
    { name: 'description', label: 'Description', type: 'textarea' },
  ];
}

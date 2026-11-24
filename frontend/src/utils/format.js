/** Display formatting helpers. */

/**
 * `on_hold` -> `On hold`.
 * @param {?string} value
 */
export function labelize(value) {
  if (!value) return '';
  const text = String(value).replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Format an ISO date (`YYYY-MM-DD`) or timestamp for display; empty for null.
 * @param {?string} value
 */
export function formatDate(value) {
  if (!value) return '';
  const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Format an amount in the configured currency.
 * @param {?number} value
 * @param {string} currency ISO 4217 code
 */
export function formatMoney(value, currency) {
  if (value === null || value === undefined) return '';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Number(value).toLocaleString()}`;
  }
}

/**
 * Turn enum values into select options.
 * @param {string[]} values
 * @returns {{value: string, label: string}[]}
 */
export const toOptions = (values) => (values || []).map((value) => ({ value, label: labelize(value) }));

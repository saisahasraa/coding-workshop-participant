/** Form validation shared by dialogs. */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Client-side checks mirroring the API, so most mistakes are caught before submitting.
 * @param {object[]} fields Field descriptors (see FormDialog)
 * @param {object} values Current input values
 * @returns {Object<string, string>} field -> message
 */
export function validate(fields, values) {
  const errors = {};
  fields.forEach((field) => {
    const value = values[field.name];
    if (field.disabled || field.type === 'switch') return;
    if (field.required && (value === '' || value === null || value === undefined)) {
      errors[field.name] = 'Required';
      return;
    }
    if (value === '' || value === null) return;
    if (field.type === 'email' && !EMAIL_RE.test(value)) errors[field.name] = 'Enter a valid email address';
    if (field.type === 'number') {
      const number = Number(value);
      if (Number.isNaN(number)) errors[field.name] = 'Enter a number';
      else if (field.min !== undefined && number < field.min) errors[field.name] = `Must be at least ${field.min}`;
      else if (field.max !== undefined && number > field.max) errors[field.name] = `Must be at most ${field.max}`;
    }
    if (field.type === 'date') {
      if (field.min && value < field.min) errors[field.name] = `Must be on or after ${field.min}`;
      if (field.max && value > field.max) errors[field.name] = `Must be on or before ${field.max}`;
    }
    if (field.pattern && !new RegExp(field.pattern).test(String(value))) {
      errors[field.name] = field.patternMessage || 'Invalid format';
    }
    if (field.minLength && String(value).length < field.minLength) {
      errors[field.name] = `Must be at least ${field.minLength} characters`;
    }
  });
  return errors;
}

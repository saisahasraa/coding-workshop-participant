import { Fragment, useState } from 'react';
import PropTypes from 'prop-types';
import { useMediaQuery } from 'react-responsive';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { ApiError } from '../api/client';
import { validate } from '../utils/validation';
import Person from './Person';

/** Value shown in an input for a stored value. */
function toInput(field, value) {
  if (field.type === 'switch') return Boolean(value);
  return value === null || value === undefined ? '' : String(value);
}

/** Value sent to the API for an input value (empty optional fields become null). */
function fromInput(field, value) {
  if (field.type === 'switch') return Boolean(value);
  if (value === '') return null;
  if (field.type === 'number') return Number(value);
  if (field.type === 'select' && field.numeric) return Number(value);
  return value;
}

/** Selects with more options than this become searchable. */
const SEARCHABLE_FROM = 8;

/** Fields that take the full width of the two-column form unless a descriptor says otherwise. */
const isWide = (field) => field.wide ?? (field.type === 'textarea' || field.type === 'switch');

/**
 * Create/edit dialog driven by field descriptors, laid out in titled sections on a two-column grid.
 *
 * On edit (`initialValues` with `id`), only changed fields are submitted. `editableFields`
 * (from the record's `permissions`) disables everything else.
 */
export default function FormDialog({
  open, title, subtitle, fields, initialValues = {}, editableFields = null, submitLabel = 'Save', onSubmit, onClose,
}) {
  const fullScreen = useMediaQuery({ maxWidth: 599 });
  const isEdit = Boolean(initialValues.id);
  const [values, setValues] = useState(
    () => Object.fromEntries(fields.map((f) => [f.name, toInput(f, initialValues[f.name] ?? f.defaultValue)])),
  );
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);

  const isDisabled = (field) => field.disabled || (editableFields !== null && !editableFields.includes(field.name));
  const effectiveFields = fields.map((f) => ({ ...f, disabled: isDisabled(f) }));

  const setValue = (field, raw) => {
    const value = field.transform ? field.transform(raw) : raw;
    setTouched((prev) => ({ ...prev, [field.name]: true }));
    setValues((prev) => {
      const next = { ...prev, [field.name]: value };
      // Fill fields derived from this one (e.g. a project key from its name) until edited by hand.
      fields.filter((f) => f.deriveFrom === field.name && !touched[f.name] && !isEdit)
        .forEach((f) => { next[f.name] = f.derive(value); });
      return next;
    });
    setErrors((prev) => ({ ...prev, [field.name]: undefined }));
  };
  const handleChange = (field) => (event) => setValue(field, field.type === 'switch' ? event.target.checked : event.target.value);

  const renderField = (field) => {
    const common = {
      name: field.name, label: field.label, required: field.required, disabled: field.disabled || busy,
      error: Boolean(errors[field.name]), helperText: errors[field.name] || field.helperText,
    };
    if (field.type === 'switch') {
      return (
        <FormControlLabel
          control={<Switch checked={values[field.name]} onChange={handleChange(field)} disabled={common.disabled} />}
          label={field.label}
        />
      );
    }
    const options = field.options || [];
    if (field.type === 'select' && (field.person || options.length >= SEARCHABLE_FROM)) {
      return (
        <Autocomplete
          options={options}
          value={options.find((option) => String(option.value) === values[field.name]) || null}
          onChange={(_event, option) => setValue(field, option ? String(option.value) : '')}
          getOptionLabel={(option) => option.label}
          isOptionEqualToValue={(a, b) => a.value === b.value}
          disabled={common.disabled}
          disableClearable={Boolean(field.required)}
          autoHighlight
          renderOption={({ key, ...props }, option) => (
            <li key={key} {...props}>{field.person ? <Person name={option.label} /> : option.label}</li>
          )}
          renderInput={(params) => <TextField {...params} {...common} placeholder={field.required ? undefined : 'None'} />}
        />
      );
    }
    return (
      <TextField
        {...common}
        type={field.type === 'select' || field.type === 'textarea' ? 'text' : field.type || 'text'}
        select={field.type === 'select'}
        multiline={field.type === 'textarea'}
        minRows={field.type === 'textarea' ? 3 : undefined}
        value={values[field.name]}
        onChange={handleChange(field)}
        autoComplete={field.autoComplete}
        slotProps={{
          inputLabel: field.type === 'date' ? { shrink: true } : undefined,
          htmlInput: { min: field.min, max: field.max, step: field.step },
          input: field.suffix ? { endAdornment: <InputAdornment position="end">{field.suffix}</InputAdornment> } : undefined,
        }}
      >
        {field.type === 'select' && [
          !field.required && <MenuItem key="__none" value=""><em>None</em></MenuItem>,
          ...options.map((option) => <MenuItem key={option.value} value={String(option.value)}>{option.label}</MenuItem>),
        ]}
      </TextField>
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const clientErrors = validate(effectiveFields, values);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) return;

    const payload = {};
    effectiveFields.forEach((field) => {
      if (field.disabled) return;
      const next = fromInput(field, values[field.name]);
      if (field.type === 'password' && next === null) return; // blank password = unchanged
      const before = isEdit ? fromInput(field, toInput(field, initialValues[field.name])) : undefined;
      if (!isEdit || next !== before) payload[field.name] = next;
    });
    if (isEdit && !Object.keys(payload).length) {
      onClose();
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await onSubmit(payload);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        const known = Object.fromEntries(Object.entries(err.details).filter(([k]) => fields.some((f) => f.name === k)));
        setErrors(known);
        const unknown = Object.keys(err.details).filter((k) => !(k in known));
        setFormError(unknown.length ? `${err.message}: ${unknown.map((k) => `${k} ${err.details[k]}`).join('; ')}` : err.message);
      } else {
        setFormError(err.message || 'Something went wrong');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth={fields.length > 6 ? 'md' : 'sm'} fullScreen={fullScreen}
      aria-labelledby="form-dialog-title">
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle id="form-dialog-title" sx={{ pr: 7, pb: subtitle ? 0.5 : undefined }}>
          {title}
          <IconButton aria-label="Close" onClick={onClose} disabled={busy} sx={{ position: 'absolute', right: 12, top: 12 }}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {subtitle && <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>{subtitle}</Typography>}
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, alignItems: 'start' }}>
            {effectiveFields.map((field, index) => (
              <Fragment key={field.name}>
                {field.section && field.section !== effectiveFields[index - 1]?.section && (
                  <Typography variant="overline" component="h3" sx={{
                    gridColumn: '1 / -1', color: 'text.secondary', letterSpacing: '0.08em', lineHeight: 1.6, mt: index ? 1 : 0, mb: -0.5,
                  }}>
                    {field.section}
                  </Typography>
                )}
                <Box sx={{ gridColumn: { sm: isWide(field) ? '1 / -1' : 'auto' }, minWidth: 0 }}>{renderField(field)}</Box>
              </Fragment>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', mr: 'auto', display: { xs: 'none', sm: 'block' } }}>* required</Typography>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

const fieldShape = PropTypes.shape({
  name: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  type: PropTypes.oneOf(['text', 'email', 'password', 'number', 'date', 'select', 'textarea', 'switch']),
  required: PropTypes.bool,
  disabled: PropTypes.bool,
  options: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]), label: PropTypes.string })),
  /** For selects whose option values are ids: submit as numbers. */
  numeric: PropTypes.bool,
  /** Number, or ISO date string for date fields. */
  min: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  max: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  step: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  minLength: PropTypes.number,
  /** Regular expression the value must match, with `patternMessage` shown otherwise. */
  pattern: PropTypes.string,
  patternMessage: PropTypes.string,
  helperText: PropTypes.string,
  autoComplete: PropTypes.string,
  /** Normalizes typed input, e.g. `(v) => v.toUpperCase()`. */
  transform: PropTypes.func,
  /** Name of a field whose value suggests this one (create only, until edited). */
  deriveFrom: PropTypes.string,
  /** Computes the suggestion from `deriveFrom`'s value. */
  derive: PropTypes.func,
  defaultValue: PropTypes.any,
  /** Heading shown above the first field of each section. */
  section: PropTypes.string,
  /** Take both columns (default for text areas and switches). */
  wide: PropTypes.bool,
  /** The options are people: searchable, shown with avatars. */
  person: PropTypes.bool,
  /** Unit shown at the end of the input, e.g. `h` or `%`. */
  suffix: PropTypes.string,
});

FormDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  title: PropTypes.string.isRequired,
  /** One line under the title saying what the form is for. */
  subtitle: PropTypes.string,
  fields: PropTypes.arrayOf(fieldShape).isRequired,
  /** Existing record when editing (must include `id`). */
  initialValues: PropTypes.object,
  /** Names the user may change; `null` means all. */
  editableFields: PropTypes.arrayOf(PropTypes.string),
  submitLabel: PropTypes.string,
  /** Receives the payload; reject with an ApiError to show field errors. */
  onSubmit: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

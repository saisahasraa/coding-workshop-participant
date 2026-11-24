import { useState } from 'react';
import PropTypes from 'prop-types';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ProgressCell from '../../components/ProgressCell';
import { formatDate, labelize } from '../../utils/format';

/** One label/value row in the details panel. */
function Row({ label, children }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '110px 1fr', md: '120px 1fr' }, gap: 1, alignItems: 'center', py: 0.75 }}>
      <Typography variant="body2" color="text.secondary" component="div">{label}</Typography>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

Row.propTypes = { label: PropTypes.string.isRequired, children: PropTypes.node };

/**
 * A metadata field that is a dropdown/date/number input when editable and plain text otherwise.
 * `onSave(value)` is called when the value changes; errors are shown under the control.
 */
function Editable({ label, name, type = 'text', value, display, editable, options, onSave, min, max }) {
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(null);

  if (!editable) return <Row label={label}><Typography component="div" noWrap>{display ?? (value || '—')}</Typography></Row>;

  const commit = async (raw) => {
    const next = raw === '' ? null : (type === 'number' || options?.numeric ? Number(raw) : raw);
    if (next === (value ?? null)) { setDraft(null); return; }
    setError(null);
    try {
      await onSave({ [name]: next });
    } catch (err) {
      setError(err.details?.[name] || err.message);
    } finally {
      setDraft(null);
    }
  };

  const shown = draft ?? (value === null || value === undefined ? '' : String(value));
  return (
    <Row label={label}>
      <TextField
        select={Boolean(options)}
        type={options ? 'text' : type}
        value={shown}
        onChange={options ? (e) => commit(e.target.value) : (e) => setDraft(e.target.value)}
        onBlur={options ? undefined : (e) => commit(e.target.value)}
        onKeyDown={options ? undefined : (e) => { if (e.key === 'Enter') e.target.blur(); }}
        error={Boolean(error)}
        helperText={error}
        slotProps={{
          htmlInput: { 'aria-label': label, min, max },
          inputLabel: { shrink: true },
        }}
        variant="standard"
      >
        {options && !options.required && <MenuItem value=""><em>{options.emptyLabel || 'None'}</em></MenuItem>}
        {options?.items.map((o) => <MenuItem key={o.value} value={String(o.value)}>{o.label}</MenuItem>)}
      </TextField>
    </Row>
  );
}

Editable.propTypes = {
  label: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  type: PropTypes.string,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  display: PropTypes.node,
  editable: PropTypes.bool,
  options: PropTypes.shape({
    items: PropTypes.array.isRequired, numeric: PropTypes.bool, required: PropTypes.bool, emptyLabel: PropTypes.string,
  }),
  onSave: PropTypes.func.isRequired,
  min: PropTypes.string,
  max: PropTypes.string,
};

/**
 * Right-hand metadata panel (Jira-style): status, people, priority, dates, estimate, progress.
 * Fields the user may change become inline controls; everything else is read-only text.
 */
export default function DetailsPanel({ item, meta, people, onSave }) {
  const allowed = item.permissions.editable_fields;
  const can = (name) => item.permissions.update && (allowed === null || allowed.includes(name));
  const statuses = (meta?.deliverable_statuses || []).map((s) => ({ value: s.value, label: labelize(s.value) }));
  const priorities = (meta?.priorities || []).map((p) => ({ value: p, label: labelize(p) }));
  const peopleItems = people.map((p) => ({ value: p.value, label: p.label }));

  return (
    <Card>
      <CardContent>
        <Typography variant="h3" gutterBottom>Details</Typography>
        <Editable label="Status" name="status" value={item.status} display={labelize(item.status)} editable={can('status')}
          options={{ items: statuses, required: true }} onSave={onSave} />
        <Editable label="Assignee" name="owner_id" value={item.owner_id} display={item.owner_name || 'Unassigned'} editable={can('owner_id')}
          options={{ items: peopleItems, numeric: true, emptyLabel: 'Unassigned' }} onSave={onSave} />
        <Editable label="Reporter" name="reporter_id" value={item.reporter_id} display={item.reporter_name || '—'} editable={can('reporter_id')}
          options={{ items: peopleItems, numeric: true, emptyLabel: 'None' }} onSave={onSave} />
        <Editable label="Priority" name="priority" value={item.priority} display={labelize(item.priority)} editable={can('priority')}
          options={{ items: priorities, required: true }} onSave={onSave} />
        <Editable label="Due date" name="due_date" type="date" value={item.due_date} display={formatDate(item.due_date) || 'None'}
          editable={can('due_date')} min={item.project_start_date || undefined} max={item.project_end_date || undefined} onSave={onSave} />
        <Editable label="Estimate (h)" name="estimated_hours" type="number" value={item.estimated_hours}
          display={item.estimated_hours != null ? `${item.estimated_hours} h` : 'None'} editable={can('estimated_hours')} onSave={onSave} />
        <Editable label="Progress (%)" name="progress_pct" type="number" value={item.progress_pct} display={<ProgressCell value={item.progress_pct} />}
          editable={can('progress_pct')} min="0" max="100" onSave={onSave} />
        <Row label="Project">
          <Link component={RouterLink} to={`/projects/${item.project_key}`} noWrap display="block">{item.project_key} · {item.project_name}</Link>
        </Row>
        <Stack sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="body2" color="text.secondary">Created {formatDate(item.created_at)}</Typography>
          <Typography variant="body2" color="text.secondary">Updated {formatDate(item.updated_at)}</Typography>
          {item.completed_at && <Typography variant="body2" color="text.secondary">Completed {formatDate(item.completed_at)}</Typography>}
        </Stack>
      </CardContent>
    </Card>
  );
}

DetailsPanel.propTypes = {
  item: PropTypes.object.isRequired,
  meta: PropTypes.object,
  /** `{value, label}` options for assignee/reporter. */
  people: PropTypes.arrayOf(PropTypes.object).isRequired,
  /** Receives `{field: value}`; resolves when saved, rejects with an ApiError otherwise. */
  onSave: PropTypes.func.isRequired,
};

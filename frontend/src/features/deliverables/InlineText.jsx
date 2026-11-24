import { useState } from 'react';
import PropTypes from 'prop-types';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

/**
 * A text block that turns into an editor on click (Jira-style) when `editable`.
 * `onSave` receives the new text; a rejected promise keeps the editor open with the error.
 */
export default function InlineText({
  label, value, editable, onSave, placeholder, multiline = true, variant = 'body1',
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const start = () => { setDraft(value || ''); setError(null); setEditing(true); };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(draft.trim() === '' ? null : draft.trim());
      setEditing(false);
    } catch (err) {
      setError(err.details ? Object.values(err.details).join('; ') : err.message);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <Stack spacing={1}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          autoFocus
          label={label}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          multiline={multiline}
          minRows={multiline ? 4 : undefined}
          disabled={busy}
          onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
        />
        <Stack direction="row" spacing={1}>
          <Button variant="contained" size="small" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          <Button size="small" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
        </Stack>
      </Stack>
    );
  }

  const content = (
    <Typography variant={variant} sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} color={value ? 'text.primary' : 'text.secondary'}>
      {value || placeholder}
    </Typography>
  );
  if (!editable) return content;
  return (
    <Box
      component="button"
      type="button"
      onClick={start}
      aria-label={`Edit ${label.toLowerCase()}`}
      sx={{
        all: 'unset', display: 'block', width: '100%', boxSizing: 'border-box', cursor: 'text', borderRadius: 1, p: 1, m: -1,
        '&:hover, &:focus-visible': { bgcolor: 'action.hover' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
      }}
    >
      {content}
    </Box>
  );
}

InlineText.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string,
  editable: PropTypes.bool,
  onSave: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
  multiline: PropTypes.bool,
  variant: PropTypes.string,
};

import { useCallback, useState } from 'react';
import PropTypes from 'prop-types';
import { Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { addLink, deleteLink, listLinks } from '../../api/collab';
import { useNotify } from '../../components/NotificationProvider';
import StatusChip from '../../components/StatusChip';
import useApi from '../../hooks/useApi';

const GROUPS = [
  { type: 'blocks', title: 'Blocks' },
  { type: 'is_blocked_by', title: 'Is blocked by' },
  { type: 'relates_to', title: 'Relates to' },
];

/** Linked work items, grouped by relationship. Project managers can add and remove links. */
export default function LinksSection({ deliverableKey, canEdit, onChanged }) {
  const notify = useNotify();
  const loader = useCallback((signal) => listLinks(deliverableKey, signal), [deliverableKey]);
  const { data, error, reload } = useApi(loader);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState('blocks');
  const [target, setTarget] = useState('');
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);

  const links = data?.data || [];
  const changed = () => { reload(); onChanged?.(); };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await addLink(deliverableKey, type, target.trim().toUpperCase());
      setTarget('');
      setAdding(false);
      changed();
    } catch (err) {
      setFormError(err.details?.target || err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (link) => {
    try {
      await deleteLink(deliverableKey, link.id);
      notify(`Unlinked ${link.key}`);
      changed();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <Box component="section" aria-labelledby="links-heading">
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography id="links-heading" variant="h3">Linked work items</Typography>
        {canEdit && !adding && <Button size="small" onClick={() => setAdding(true)}>Link work item</Button>}
      </Stack>
      {error && <Alert severity="error">{error.message}</Alert>}
      {adding && (
        <form onSubmit={submit}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }} alignItems={{ sm: 'flex-start' }}>
            <TextField select label="Relationship" value={type} onChange={(e) => setType(e.target.value)} sx={{ minWidth: 170 }} fullWidth={false}>
              {GROUPS.map((g) => <MenuItem key={g.type} value={g.type}>{g.title}</MenuItem>)}
            </TextField>
            <TextField label="Work item key" placeholder="ENG-12" value={target} onChange={(e) => setTarget(e.target.value)}
              error={Boolean(formError)} helperText={formError} autoFocus required />
            <Button type="submit" variant="contained" disabled={busy || !target.trim()}>Link</Button>
            <Button onClick={() => { setAdding(false); setFormError(null); }} disabled={busy}>Cancel</Button>
          </Stack>
        </form>
      )}
      {!links.length && !adding && <Typography color="text.secondary">No linked work items.</Typography>}
      {GROUPS.map(({ type: groupType, title }) => {
        const items = links.filter((l) => l.type === groupType);
        if (!items.length) return null;
        return (
          <Box key={groupType} sx={{ mb: 1.5 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>{title}</Typography>
            <Stack spacing={0.5} component="ul" sx={{ p: 0, m: 0, listStyle: 'none' }}>
              {items.map((link) => (
                <Stack key={link.id} component="li" direction="row" spacing={1} alignItems="center"
                  sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 0.5 }}>
                  <Link component={RouterLink} to={`/deliverables/${link.key}`} underline="hover" fontWeight={600}>{link.key}</Link>
                  <Typography noWrap sx={{ flexGrow: 1, minWidth: 0 }}>{link.name}</Typography>
                  <StatusChip value={link.status} />
                  {canEdit && (
                    <IconButton size="small" aria-label={`Remove link to ${link.key}`} onClick={() => remove(link)}><CloseIcon fontSize="small" /></IconButton>
                  )}
                </Stack>
              ))}
            </Stack>
          </Box>
        );
      })}
    </Box>
  );
}

LinksSection.propTypes = {
  deliverableKey: PropTypes.string.isRequired,
  canEdit: PropTypes.bool,
  /** Called after a link is added or removed. */
  onChanged: PropTypes.func,
};

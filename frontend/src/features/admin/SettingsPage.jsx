import { useCallback, useState } from 'react';
import PropTypes from 'prop-types';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { auditApi, settingsApi } from '../../api/resources';
import { useNotify } from '../../components/NotificationProvider';
import PageHeader from '../../components/PageHeader';
import useApi from '../../hooks/useApi';
import { formatDateTime, labelize } from '../../utils/format';
import { describeValue, fromDraft, GROUP_TITLES, isList, toDraft } from './settingEditors';

function History({ setting, onClose }) {
  const loader = useCallback((signal) => auditApi.list({ entity: 'app_settings', entity_id: setting.key, limit: 10 }, signal), [setting.key]);
  const { data, error } = useApi(loader);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="history-title">
      <DialogTitle id="history-title">History of {setting.key}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error">{error.message}</Alert>}
        {!data && !error && <LinearProgress aria-label="Loading history" />}
        {data && !data.data.length && <Typography color="text.secondary">Never changed from its default.</Typography>}
        <Stack component="ul" spacing={1} sx={{ p: 0, m: 0, listStyle: 'none' }}>
          {(data?.data || []).map((row) => (
            <li key={row.id}>
              <Typography>{describeValue(row.changes.value?.from)} → <b>{describeValue(row.changes.value?.to)}</b></Typography>
              <Typography variant="body2" color="text.secondary">{row.actor_name || 'Unknown'} · {formatDateTime(row.created_at)}</Typography>
            </li>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

History.propTypes = { setting: PropTypes.shape({ key: PropTypes.string.isRequired }).isRequired, onClose: PropTypes.func.isRequired };

function Editor({ setting, draft, onChange, error }) {
  const label = setting.key;
  if (setting.kind === 'bool') {
    return <FormControlLabel control={<Switch checked={draft} onChange={(e) => onChange(e.target.checked)} />} label={label} />;
  }
  if (setting.kind === 'choice') {
    return (
      <TextField select label={label} value={draft} onChange={(e) => onChange(e.target.value)} error={Boolean(error)} helperText={error}>
        {setting.choices.map((c) => <MenuItem key={c} value={c}>{labelize(c)}</MenuItem>)}
      </TextField>
    );
  }
  const hint = setting.kind === 'int' && setting.minimum !== null ? `${setting.minimum} – ${setting.maximum}` : isList(setting.kind) ? 'Comma-separated' : '';
  return (
    <TextField
      label={label} value={draft} onChange={(e) => onChange(e.target.value)} error={Boolean(error)} helperText={error || hint}
      type={setting.kind === 'int' ? 'number' : 'text'}
    />
  );
}

Editor.propTypes = { setting: PropTypes.object.isRequired, draft: PropTypes.oneOfType([PropTypes.string, PropTypes.bool]).isRequired, onChange: PropTypes.func.isRequired, error: PropTypes.string };

function SettingRow({ setting, onChanged }) {
  const notify = useNotify();
  const [draft, setDraft] = useState(() => toDraft(setting, setting.value));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const dirty = toDraft(setting, setting.value) !== draft;

  const run = async (action, message) => {
    setBusy(true);
    setError('');
    try {
      await action();
      notify(message);
      onChanged();
    } catch (err) {
      setError(err.details?.value || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={1} sx={{ py: 1.5, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="body2" color="text.secondary">{setting.description}</Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'flex-start' }}>
        <Stack sx={{ flex: 1, maxWidth: { md: 420 } }}><Editor setting={setting} draft={draft} onChange={setDraft} error={error} /></Stack>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button variant="contained" disabled={!dirty || busy}
            onClick={() => run(() => settingsApi.update(setting.key, fromDraft(setting, draft)), `${setting.key} saved`)}>Save</Button>
          {setting.overridden && (
            <Button disabled={busy} onClick={() => run(async () => { await settingsApi.reset(setting.key); }, `${setting.key} reset to default`)}>Reset to default</Button>
          )}
          <Button onClick={() => setHistory(true)}>History</Button>
        </Stack>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip size="small" variant="outlined" label={`Default: ${describeValue(setting.default)}`} />
        {setting.overridden && <Chip size="small" color="primary" label="Customized" />}
        {setting.updated_at && <Typography variant="body2" color="text.secondary">Changed by {setting.updated_by_name || 'unknown'} · {formatDateTime(setting.updated_at)}</Typography>}
      </Stack>
      {history && <History setting={setting} onClose={() => setHistory(false)} />}
    </Stack>
  );
}

SettingRow.propTypes = { setting: PropTypes.object.isRequired, onChanged: PropTypes.func.isRequired };

/** Admin console for runtime settings: changes apply without a redeploy (within the settings cache window). */
export default function SettingsPage() {
  const loader = useCallback((signal) => settingsApi.list(signal), []);
  const { data, error, reload } = useApi(loader);
  if (error && !data) return <Alert severity="error">{error.message}</Alert>;
  if (!data) return <LinearProgress aria-label="Loading settings" />;

  const groups = data.data.reduce((acc, s) => ({ ...acc, [s.group]: [...(acc[s.group] || []), s] }), {});
  return (
    <>
      <PageHeader title="Settings" subtitle="Tune the system without a redeploy. Changes take effect within about 30 seconds everywhere and are recorded in the audit log." />
      <Stack spacing={2}>
        {Object.entries(groups).map(([group, settings]) => (
          <Card key={group} component="section" aria-labelledby={`group-${group}`}><CardContent>
            <Typography id={`group-${group}`} variant="h3" gutterBottom>{GROUP_TITLES[group] || labelize(group)}</Typography>
            {settings.map((s) => <SettingRow key={`${s.key}:${JSON.stringify(s.value)}`} setting={s} onChanged={reload} />)}
          </CardContent></Card>
        ))}
      </Stack>
    </>
  );
}

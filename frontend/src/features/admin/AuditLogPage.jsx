import { useCallback, useState } from 'react';
import PropTypes from 'prop-types';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { auditApi } from '../../api/resources';
import PageHeader from '../../components/PageHeader';
import ResponsiveList from '../../components/ResponsiveList';
import SearchField from '../../components/SearchField';
import useApi from '../../hooks/useApi';
import useListQuery from '../../hooks/useListQuery';
import { formatDateTime, labelize } from '../../utils/format';
import { changeLines } from './changeLines';
import ToneChip from '../../components/ToneChip';

const ENTITIES = ['projects', 'deliverables', 'expenses', 'users', 'teams', 'departments', 'leaves', 'comments', 'deliverable_links', 'app_settings'];
const ACTIONS = ['create', 'update', 'delete'];
const ACTION_COLORS = { create: 'success', update: 'primary', delete: 'error' };

function Detail({ entry, onClose }) {
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="audit-title">
      <DialogTitle id="audit-title">{labelize(entry.action)} · {entry.entity} {entry.entity_id}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" gutterBottom sx={{
          color: "text.secondary"
        }}>
          {entry.actor_name || 'Unknown'} · {formatDateTime(entry.created_at)}{entry.request_id && ` · request ${entry.request_id}`}
        </Typography>
        <Stack component="dl" spacing={1} sx={{ m: 0 }}>
          {changeLines(entry).map(([field, text]) => (
            <div key={field}>
              <Typography component="dt" variant="body2" sx={{
                color: "text.secondary"
              }}>{field}</Typography>
              <Typography component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>{text}</Typography>
            </div>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

Detail.propTypes = { entry: PropTypes.object.isRequired, onClose: PropTypes.func.isRequired };

const COLUMNS = [
  { field: 'created_at', headerName: 'When', width: 180, valueFormatter: (value) => formatDateTime(value) },
  { field: 'actor', headerName: 'Who', width: 170, valueGetter: (_v, row) => row.actor_name || 'Unknown' },
  { field: 'action', headerName: 'Action', width: 110, renderCell: ({ value }) => <ToneChip tone={ACTION_COLORS[value]} label={labelize(value)} /> },
  { field: 'entity', headerName: 'Entity', width: 160 },
  { field: 'entity_id', headerName: 'ID', width: 140, sortable: false },
  { field: 'changes', headerName: 'Changes', flex: 1, minWidth: 220, sortable: false, valueGetter: (_v, row) => changeLines(row).map(([f]) => f).join(', ') },
];

/** Who changed what and when. */
export default function AuditLogPage() {
  const list = useListQuery({ sort: '-created_at', filters: ['entity', 'action', 'from', 'to'] });
  const [selected, setSelected] = useState(null);
  const { query } = list;
  const loader = useCallback((signal) => auditApi.list(query, signal), [query]);
  const { data, error, loading } = useApi(loader);

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every create, update and delete, with who did it. Open an entry to see the fields." />
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{
          alignItems: { md: 'center' },
          mb: 2
        }}>
        <SearchField value={list.q} onChange={list.setSearch} label="Search entity, id or person" />
        <TextField select label="Entity" value={list.values.entity} onChange={(e) => list.setFilter('entity', e.target.value)} sx={{ minWidth: 180 }} fullWidth={false}>
          <MenuItem value="">All entities</MenuItem>
          {ENTITIES.map((e) => <MenuItem key={e} value={e}>{e}</MenuItem>)}
        </TextField>
        <TextField select label="Action" value={list.values.action} onChange={(e) => list.setFilter('action', e.target.value)} sx={{ minWidth: 140 }} fullWidth={false}>
          <MenuItem value="">Any action</MenuItem>
          {ACTIONS.map((a) => <MenuItem key={a} value={a}>{labelize(a)}</MenuItem>)}
        </TextField>
        <TextField label="From" type="date" value={list.values.from} onChange={(e) => list.setFilter('from', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} fullWidth={false} />
        <TextField label="To" type="date" value={list.values.to} onChange={(e) => list.setFilter('to', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} fullWidth={false} />
      </Stack>
      <ResponsiveList
        rows={data?.data || []} total={data?.total || 0} loading={loading} error={error} columns={COLUMNS}
        page={list.page} pageSize={list.pageSize} sort={list.sort}
        onPageChange={list.setPage} onPageSizeChange={list.setPageSize} onSortChange={list.setSort}
        onRowClick={setSelected}
        emptyText="No entries match these filters."
        renderCard={(row) => (
          <Stack spacing={0.5}>
            <Stack direction="row" sx={{
              justifyContent: "space-between"
            }}><Typography sx={{
              fontWeight: 600
            }}>{row.entity} {row.entity_id}</Typography><ToneChip tone={ACTION_COLORS[row.action]} label={labelize(row.action)} /></Stack>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>{row.actor_name || 'Unknown'} · {formatDateTime(row.created_at)}</Typography>
          </Stack>
        )}
      />
      {selected && <Detail entry={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

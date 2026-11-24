import { useCallback, useState } from 'react';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { leavesApi } from '../../api/resources';
import { useAuth } from '../../auth/AuthContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import FormDialog from '../../components/FormDialog';
import { useNotify } from '../../components/NotificationProvider';
import PageHeader from '../../components/PageHeader';
import ResponsiveList from '../../components/ResponsiveList';
import SearchField from '../../components/SearchField';
import StatusChip from '../../components/StatusChip';
import useApi from '../../hooks/useApi';
import useListQuery from '../../hooks/useListQuery';
import { useMeta } from '../../meta/MetaContext';
import { formatDate, labelize } from '../../utils/format';
import leaveFields from './leaveFields';
import leaveLength from './leaveLength';
import useLeavePeople from './useLeavePeople';

/** Planned leave of everyone, with recording and editing for those allowed. */
export default function LeavePage() {
  const notify = useNotify();
  const { can } = useAuth();
  const { meta } = useMeta();
  const list = useListQuery({ sort: '-start_date', filters: ['type', 'from', 'to', 'user_id'] });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const { people } = useLeavePeople(Boolean(editing));

  const { query } = list;
  const loader = useCallback((signal) => leavesApi.list(query, signal), [query]);
  const { data, error, loading, reload } = useApi(loader);

  const actions = (row) => (
    <Stack direction="row" spacing={0.5} onClick={(e) => e.stopPropagation()}>
      {row.permissions.update && (
        <Tooltip title="Edit"><IconButton size="small" aria-label={`Edit leave of ${row.user_name}`} onClick={() => setEditing(row)}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
      )}
      {row.permissions.delete && (
        <Tooltip title="Delete"><IconButton size="small" aria-label={`Delete leave of ${row.user_name}`} onClick={() => setDeleting(row)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
      )}
    </Stack>
  );

  const columns = [
    { field: 'user', headerName: 'Person', flex: 1, minWidth: 160, valueGetter: (_v, row) => row.user_name },
    { field: 'type', headerName: 'Type', width: 120, renderCell: ({ value }) => <StatusChip value={value} /> },
    { field: 'start_date', headerName: 'From', width: 130, valueFormatter: (value) => formatDate(value) },
    { field: 'end_date', headerName: 'To', width: 130, valueFormatter: (value) => formatDate(value) },
    { field: 'days', headerName: 'Days', width: 80, sortable: false, valueGetter: (_v, row) => leaveLength(row) },
    { field: 'note', headerName: 'Note', flex: 1, minWidth: 140, sortable: false },
    { field: 'actions', headerName: '', width: 96, sortable: false, renderCell: ({ row }) => actions(row) },
  ];

  return (
    <>
      <PageHeader
        title="Planned leave"
        subtitle="Time off that lowers a person's availability in the capacity report."
        actions={can('leaves', 'create') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>Record leave</Button>
        )}
      />
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{
          alignItems: { md: 'center' },
          mb: 2
        }}>
        <SearchField value={list.q} onChange={list.setSearch} label="Search person or note" />
        <TextField select label="Type" value={list.values.type} onChange={(e) => list.setFilter('type', e.target.value)} sx={{ minWidth: 150 }} fullWidth={false}>
          <MenuItem value="">All types</MenuItem>
          {(meta?.settings?.['leaves.types'] || []).map((t) => <MenuItem key={t} value={t}>{labelize(t)}</MenuItem>)}
        </TextField>
        <TextField label="From" type="date" value={list.values.from} onChange={(e) => list.setFilter('from', e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }} fullWidth={false} />
        <TextField label="To" type="date" value={list.values.to} onChange={(e) => list.setFilter('to', e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }} fullWidth={false} />
        <FormControlLabel
          control={<Switch checked={list.values.user_id === 'me'} onChange={(e) => list.setFilter('user_id', e.target.checked ? 'me' : '')} />}
          label="Only mine"
        />
      </Stack>
      <ResponsiveList
        rows={data?.data || []} total={data?.total || 0} loading={loading} error={error} columns={columns}
        page={list.page} pageSize={list.pageSize} sort={list.sort}
        onPageChange={list.setPage} onPageSizeChange={list.setPageSize} onSortChange={list.setSort}
        emptyText="No leave recorded for these filters."
        renderCard={(row) => (
          <Stack spacing={0.5}>
            <Stack
              direction="row"
              sx={{
                justifyContent: "space-between",
                alignItems: "flex-start"
              }}>
              <Typography sx={{
                fontWeight: 600
              }}>{row.user_name}</Typography>
              {actions(row)}
            </Stack>
            <Stack direction="row" spacing={1} sx={{
              alignItems: "center"
            }}><StatusChip value={row.type} /><Typography variant="body2">{leaveLength(row)} day(s)</Typography></Stack>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>{formatDate(row.start_date)} – {formatDate(row.end_date)}</Typography>
            {row.note && <Typography variant="body2">{row.note}</Typography>}
          </Stack>
        )}
      />
      {editing && (
        <FormDialog
          open
          title={editing.id ? `Edit leave of ${editing.user_name}` : 'Record leave'}
          fields={leaveFields(meta, people)}
          initialValues={editing}
          editableFields={editing.id ? editing.permissions.editable_fields : null}
          submitLabel={editing.id ? 'Save' : 'Record'}
          onSubmit={async (values) => {
            if (editing.id) await leavesApi.update(editing.id, values); else await leavesApi.create(values);
            notify(editing.id ? 'Leave updated' : 'Leave recorded');
            reload();
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          title="Delete leave?"
          message={`${deleting.user_name}: ${formatDate(deleting.start_date)} – ${formatDate(deleting.end_date)} will be removed.`}
          onConfirm={async () => { await leavesApi.remove(deleting.id); notify('Leave deleted'); reload(); }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

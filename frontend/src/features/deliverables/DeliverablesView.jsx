import { useCallback, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { deliverablesApi } from '../../api/resources';
import ConfirmDialog from '../../components/ConfirmDialog';
import FormDialog from '../../components/FormDialog';
import { useNotify } from '../../components/NotificationProvider';
import ProgressCell from '../../components/ProgressCell';
import ResponsiveList from '../../components/ResponsiveList';
import SearchField from '../../components/SearchField';
import StatusChip from '../../components/StatusChip';
import useApi from '../../hooks/useApi';
import useListQuery from '../../hooks/useListQuery';
import useLookups from '../../hooks/useLookups';
import { useMeta } from '../../meta/MetaContext';
import { formatDate, labelize } from '../../utils/format';
import deliverableFields from './deliverableFields';

function DueDate({ row }) {
  if (!row.due_date) return null;
  return (
    <Typography variant="body2" component="span" color={row.is_overdue ? 'error' : 'inherit'} fontWeight={row.is_overdue ? 600 : 400}>
      {formatDate(row.due_date)}{row.is_overdue && ' · overdue'}
    </Typography>
  );
}

DueDate.propTypes = { row: PropTypes.object.isRequired };

/**
 * Deliverables list with filters and per-record edit/delete according to the API's permissions.
 * `baseQuery` fixes filters (e.g. `{project_id}` or `{owner_id: 'me'}`).
 */
export default function DeliverablesView({
  baseQuery, projectId = null, projectDates = {}, canCreate = false, showProject = false, onChange,
}) {
  const notify = useNotify();
  const navigate = useNavigate();
  const { meta } = useMeta();
  const list = useListQuery({ sort: 'due_date', filters: ['status', 'overdue'] });
  const [editing, setEditing] = useState(null); // {} = new, record = edit
  const [deleting, setDeleting] = useState(null);
  const lookups = useLookups(['assignees'], Boolean(editing));

  const { query } = list;
  const fullQuery = useMemo(() => ({ ...query, ...baseQuery }), [query, baseQuery]);
  const loader = useCallback((signal) => deliverablesApi.list(fullQuery, signal), [fullQuery]);
  const { data, error, loading, reload } = useApi(loader);

  const refresh = () => { reload(); onChange?.(); };

  const handleSubmit = async (values) => {
    if (editing.id) {
      await deliverablesApi.update(editing.id, values);
      notify('Deliverable updated');
    } else {
      await deliverablesApi.create({ ...values, project_id: projectId });
      notify('Deliverable added');
    }
    refresh();
  };

  const actions = (row) => (
    <Stack direction="row" spacing={0.5} onClick={(e) => e.stopPropagation()}>
      {row.permissions.update && (
        <Tooltip title="Edit"><IconButton size="small" aria-label={`Edit ${row.name}`} onClick={() => setEditing(row)}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
      )}
      {row.permissions.delete && (
        <Tooltip title="Delete"><IconButton size="small" aria-label={`Delete ${row.name}`} onClick={() => setDeleting(row)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
      )}
    </Stack>
  );

  const columns = [
    { field: 'key', headerName: 'Key', width: 100 },
    { field: 'name', headerName: 'Deliverable', flex: 1, minWidth: 180 },
    ...(showProject ? [{ field: 'project', headerName: 'Project', width: 100, valueGetter: (_v, row) => row.project_key }] : []),
    { field: 'owner', headerName: 'Owner', width: 150, valueGetter: (_v, row) => row.owner_name || '—' },
    { field: 'status', headerName: 'Status', width: 130, renderCell: ({ value }) => <StatusChip value={value} /> },
    { field: 'priority', headerName: 'Priority', width: 110, renderCell: ({ value }) => <StatusChip value={value} /> },
    { field: 'due_date', headerName: 'Due', width: 160, renderCell: ({ row }) => <DueDate row={row} /> },
    { field: 'progress_pct', headerName: 'Progress', width: 150, renderCell: ({ value }) => <ProgressCell value={value} /> },
    { field: 'actions', headerName: '', width: 96, sortable: false, renderCell: ({ row }) => actions(row) },
  ];

  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }} alignItems={{ sm: 'center' }}>
        <SearchField value={list.q} onChange={list.setSearch} label="Search deliverables" />
        <TextField select label="Status" value={list.values.status} onChange={(e) => list.setFilter('status', e.target.value)}
          sx={{ minWidth: 160 }} fullWidth={false}>
          <MenuItem value="">All statuses</MenuItem>
          {(meta?.deliverable_statuses || []).map((s) => <MenuItem key={s.value} value={s.value}>{labelize(s.value)}</MenuItem>)}
        </TextField>
        <TextField select label="Due" value={list.values.overdue} onChange={(e) => list.setFilter('overdue', e.target.value)}
          sx={{ minWidth: 140 }} fullWidth={false}>
          <MenuItem value="">Any</MenuItem>
          <MenuItem value="true">Overdue</MenuItem>
          <MenuItem value="false">On track</MenuItem>
        </TextField>
        {canCreate && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})} sx={{ ml: { sm: 'auto' } }}>
            Add deliverable
          </Button>
        )}
      </Stack>
      <ResponsiveList
        rows={data?.data || []}
        total={data?.total || 0}
        loading={loading}
        error={error}
        columns={columns}
        page={list.page}
        pageSize={list.pageSize}
        sort={list.sort}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        onSortChange={list.setSort}
        onRowClick={(row) => navigate(`/deliverables/${row.key}`)}
        emptyText="No deliverables yet."
        renderCard={(row) => (
          <Stack spacing={1}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
              <Typography fontWeight={600}><Typography component="span" color="text.secondary" fontWeight={500}>{row.key}</Typography> {row.name}</Typography>
              {actions(row)}
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <StatusChip value={row.status} /><StatusChip value={row.priority} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {row.owner_name || 'Unassigned'}
              {row.due_date && ' · '}<DueDate row={row} />
            </Typography>
            <ProgressCell value={row.progress_pct} />
          </Stack>
        )}
      />
      {editing && (
        <FormDialog
          open
          title={editing.id ? `Edit ${editing.name}` : 'Add deliverable'}
          fields={deliverableFields(meta, lookups, editing.id
            ? { start: editing.project_start_date, end: editing.project_end_date } : projectDates)}
          initialValues={editing}
          editableFields={editing.id ? editing.permissions.editable_fields : null}
          submitLabel={editing.id ? 'Save' : 'Add'}
          onSubmit={handleSubmit}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          title="Delete deliverable?"
          message={`"${deleting.name}" will be permanently removed.`}
          onConfirm={async () => { await deliverablesApi.remove(deleting.id); notify('Deliverable deleted'); refresh(); }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

DeliverablesView.propTypes = {
  /** Fixed API filters. Must be memoized by the caller. */
  baseQuery: PropTypes.object.isRequired,
  /** Project new deliverables are added to. */
  projectId: PropTypes.number,
  /** Project start/end (ISO dates) that bound new deliverables' due dates. */
  projectDates: PropTypes.shape({ start: PropTypes.string, end: PropTypes.string }),
  canCreate: PropTypes.bool,
  showProject: PropTypes.bool,
  /** Called after any change (e.g. to refresh project totals). */
  onChange: PropTypes.func,
};

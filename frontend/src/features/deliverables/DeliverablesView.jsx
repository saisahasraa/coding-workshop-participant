import { useCallback, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import TableRowsOutlinedIcon from '@mui/icons-material/TableRowsOutlined';
import ViewKanbanOutlinedIcon from '@mui/icons-material/ViewKanbanOutlined';
import { deliverablesApi } from '../../api/resources';
import { useAuth } from '../../auth/AuthContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import DueDate from '../../components/DueDate';
import FormDialog from '../../components/FormDialog';
import { useNotify } from '../../components/NotificationProvider';
import Person from '../../components/Person';
import ProgressCell from '../../components/ProgressCell';
import ResponsiveList from '../../components/ResponsiveList';
import SearchField from '../../components/SearchField';
import StatusChip from '../../components/StatusChip';
import useApi from '../../hooks/useApi';
import useListQuery from '../../hooks/useListQuery';
import useLookups from '../../hooks/useLookups';
import { useMeta } from '../../meta/MetaContext';
import { labelize } from '../../utils/format';
import deliverableFields from './deliverableFields';
import DeliverablesBoard from './DeliverablesBoard';
import StatusMenu from './StatusMenu';

const BOARD_LIMIT = 200;

/**
 * Deliverables as a table (cards on phones) or a board, with filters, in-place status changes and
 * per-record edit/delete according to the API's permissions.
 * `baseQuery` fixes filters (e.g. `{project_id}` or `{owner_id: 'me'}`).
 */
export default function DeliverablesView({
  baseQuery, projectId = null, projectDates = {}, canCreate = false, showProject = false, onChange,
}) {
  const notify = useNotify();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { meta } = useMeta();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'board' ? 'board' : 'table';
  const ownerFixed = 'owner_id' in baseQuery;
  const list = useListQuery({ sort: 'due_date', filters: ['status', 'overdue', 'unassigned', ...(ownerFixed ? [] : ['owner_id'])] });
  const [editing, setEditing] = useState(null); // {} = new, record = edit
  const [deleting, setDeleting] = useState(null);
  const pickProject = projectId === null;   // creating from a list that spans projects
  const lookups = useLookups(pickProject ? ['assignees', 'openProjects'] : ['assignees'], Boolean(editing));
  const statuses = useMemo(() => (meta?.deliverable_statuses || []).map((s) => s.value), [meta]);

  const { query } = list;
  const fullQuery = useMemo(
    () => ({ ...query, ...baseQuery, ...(view === 'board' ? { limit: BOARD_LIMIT, offset: 0 } : {}) }),
    [query, baseQuery, view],
  );
  const loader = useCallback((signal) => deliverablesApi.list(fullQuery, signal), [fullQuery]);
  const { data, error, loading, reload } = useApi(loader);
  const rows = data?.data || [];

  const refresh = () => { reload(); onChange?.(); };
  const setView = (next) => setParams((prev) => {
    const copy = new URLSearchParams(prev);
    if (next === 'board') copy.set('view', 'board'); else copy.delete('view');
    return copy;
  }, { replace: true });
  const toggle = (name, value) => list.setFilter(name, list.values[name] === value ? '' : value);

  const handleSubmit = async (values) => {
    if (editing.id) {
      await deliverablesApi.update(editing.id, values);
      notify('Deliverable updated');
    } else {
      await deliverablesApi.create(pickProject ? values : { ...values, project_id: projectId });
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
  const due = (row) => <DueDate date={row.due_date} done={row.status === 'completed'} />;

  const columns = [
    { field: 'key', headerName: 'Key', width: 90, renderCell: ({ value }) => <Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.main' }}>{value}</Typography> },
    { field: 'name', headerName: 'Deliverable', flex: 1, minWidth: 160 },
    ...(showProject ? [{ field: 'project', headerName: 'Project', width: 86, valueGetter: (_v, row) => row.project_key }] : []),
    { field: 'owner', headerName: 'Owner', width: 165, renderCell: ({ row }) => <Person name={row.owner_name} /> },
    { field: 'status', headerName: 'Status', width: 142, renderCell: ({ row }) => <StatusMenu item={row} onChanged={refresh} /> },
    { field: 'priority', headerName: 'Priority', width: 96, renderCell: ({ value }) => <StatusChip value={value} /> },
    { field: 'due_date', headerName: 'Due', width: 136, renderCell: ({ row }) => due(row) },
    { field: 'progress_pct', headerName: 'Progress', width: 130, renderCell: ({ value }) => <ProgressCell value={value} /> },
    { field: 'actions', headerName: '', width: 84, sortable: false, renderCell: ({ row }) => actions(row) },
  ];

  const quick = [
    { name: 'overdue', value: 'true', label: 'Overdue' },
    ...(!ownerFixed && user.role !== 'viewer' ? [{ name: 'owner_id', value: 'me', label: 'Mine' }] : []),
    ...(!ownerFixed ? [{ name: 'unassigned', value: 'true', label: 'Unassigned' }] : []),
  ];

  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2, alignItems: { md: 'center' } }}>
        <SearchField value={list.q} onChange={list.setSearch} label="Search deliverables" />
        <TextField select label="Status" value={list.values.status} onChange={(e) => list.setFilter('status', e.target.value)}
          sx={{ minWidth: 160 }} fullWidth={false}>
          <MenuItem value="">All statuses</MenuItem>
          {statuses.map((s) => <MenuItem key={s} value={s}>{labelize(s)}</MenuItem>)}
        </TextField>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0, flexWrap: { xs: 'wrap', md: 'nowrap' }, rowGap: 1 }} role="group" aria-label="Quick filters">
          {quick.map((f) => {
            const on = list.values[f.name] === f.value;
            return <Chip key={f.name} label={f.label} clickable aria-pressed={on} color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'} onClick={() => toggle(f.name, f.value)} />;
          })}
        </Stack>
        <Stack direction="row" spacing={1.5} sx={{ ml: { md: 'auto' }, alignItems: 'center', flexShrink: 0, justifyContent: 'space-between' }}>
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_e, next) => next && setView(next)} aria-label="View">
            <ToggleButton value="table" aria-label="Table view"><TableRowsOutlinedIcon fontSize="small" /></ToggleButton>
            <ToggleButton value="board" aria-label="Board view"><ViewKanbanOutlinedIcon fontSize="small" /></ToggleButton>
          </ToggleButtonGroup>
          {canCreate && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})} sx={{ whiteSpace: 'nowrap' }}>Add deliverable</Button>}
        </Stack>
      </Stack>

      {view === 'board' ? (
        <>
          {data && data.total > rows.length && (
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>Showing the first {rows.length} of {data.total}. Narrow the filters to see the rest.</Typography>
          )}
          {error && !rows.length ? <Typography color="error">{error.message}</Typography>
            : <DeliverablesBoard rows={rows} statuses={statuses} showProject={showProject} onChanged={refresh} />}
        </>
      ) : (
        <ResponsiveList
          rows={rows}
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
          emptyText="No deliverables match."
          renderCard={(row) => (
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Typography sx={{ fontWeight: 600 }}><Typography component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>{row.key}</Typography> {row.name}</Typography>
                {actions(row)}
              </Stack>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
                <StatusMenu item={row} onChanged={refresh} /><StatusChip value={row.priority} />
              </Stack>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Person name={row.owner_name} />{due(row)}
              </Stack>
              <ProgressCell value={row.progress_pct} />
            </Stack>
          )}
        />
      )}
      {editing && (
        <FormDialog
          open
          title={editing.id ? `Edit ${editing.name}` : 'Add deliverable'}
          subtitle={editing.id ? `${editing.key} in ${editing.project_name}` : 'A piece of work with an owner and a due date.'}
          fields={deliverableFields(meta, lookups, editing.id
            ? { start: editing.project_start_date, end: editing.project_end_date } : projectDates, pickProject && !editing.id)}
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

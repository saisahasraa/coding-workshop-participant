import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import { projectsApi } from '../../api/resources';
import { useAuth } from '../../auth/AuthContext';
import FormDialog from '../../components/FormDialog';
import { useNotify } from '../../components/NotificationProvider';
import PageHeader from '../../components/PageHeader';
import ProgressCell from '../../components/ProgressCell';
import ResponsiveList from '../../components/ResponsiveList';
import SearchField from '../../components/SearchField';
import StatusChip from '../../components/StatusChip';
import useApi from '../../hooks/useApi';
import useListQuery from '../../hooks/useListQuery';
import useLookups from '../../hooks/useLookups';
import { useMeta } from '../../meta/MetaContext';
import { formatDate, labelize } from '../../utils/format';
import projectFields from './projectFields';

const COLUMNS = [
  { field: 'key', headerName: 'Key', width: 100 },
  { field: 'name', headerName: 'Name', flex: 1, minWidth: 180 },
  { field: 'status', headerName: 'Status', width: 130, renderCell: ({ value }) => <StatusChip value={value} /> },
  { field: 'priority', headerName: 'Priority', width: 110, renderCell: ({ value }) => <StatusChip value={value} /> },
  { field: 'department', headerName: 'Department', width: 140, valueGetter: (_v, row) => row.department_name },
  { field: 'manager', headerName: 'Manager', width: 150, valueGetter: (_v, row) => row.manager_name },
  { field: 'end_date', headerName: 'Target end', width: 130, valueFormatter: (value) => formatDate(value) },
  { field: 'progress_pct', headerName: 'Progress', width: 150, renderCell: ({ value }) => <ProgressCell value={value} /> },
];

/** Project list with search, filters and creation. */
export default function ProjectsPage() {
  const navigate = useNavigate();
  const notify = useNotify();
  const { can, user } = useAuth();
  const { meta } = useMeta();
  const list = useListQuery({ sort: 'key', filters: ['status', 'manager_id'] });
  const [creating, setCreating] = useState(false);
  const lookups = useLookups(['departments', 'managers'], creating);

  const { query } = list;
  const loader = useCallback((signal) => projectsApi.list(query, signal), [query]);
  const { data, error, loading, reload } = useApi(loader);

  const handleCreate = async (values) => {
    const project = await projectsApi.create(values);
    notify(`Project ${project.key} created`);
    navigate(`/projects/${project.key}`);
  };

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Status, progress and ownership of every project you can see."
        actions={can('projects', 'create') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>New project</Button>
        )}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }} alignItems={{ sm: 'center' }}>
        <SearchField value={list.q} onChange={list.setSearch} label="Search key, name, description" />
        <TextField select label="Status" value={list.values.status} onChange={(e) => list.setFilter('status', e.target.value)}
          sx={{ minWidth: 160 }} fullWidth={false}>
          <MenuItem value="">All statuses</MenuItem>
          {(meta?.project_statuses || []).map((s) => <MenuItem key={s} value={s}>{labelize(s)}</MenuItem>)}
        </TextField>
        {can('projects', 'create') && (
          <FormControlLabel
            control={<Switch checked={list.values.manager_id === 'me'} onChange={(e) => list.setFilter('manager_id', e.target.checked ? 'me' : '')} />}
            label="Managed by me"
          />
        )}
      </Stack>
      <ResponsiveList
        rows={data?.data || []}
        total={data?.total || 0}
        loading={loading}
        error={error}
        columns={COLUMNS}
        page={list.page}
        pageSize={list.pageSize}
        sort={list.sort}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        onSortChange={list.setSort}
        onRowClick={(row) => navigate(`/projects/${row.key}`)}
        emptyText="No projects match these filters."
        renderCard={(row) => (
          <Stack spacing={1}>
            <Stack direction="row" justifyContent="space-between" spacing={1}>
              <Typography fontWeight={600}>{row.key} · {row.name}</Typography>
              <StatusChip value={row.status} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {row.manager_name} · {row.department_name}{row.end_date && ` · due ${formatDate(row.end_date)}`}
            </Typography>
            <ProgressCell value={row.progress_pct} />
          </Stack>
        )}
      />
      {creating && (
        <FormDialog
          open
          title="New project"
          fields={projectFields(meta, lookups, user.role === 'admin')}
          submitLabel="Create"
          onSubmit={handleCreate}
          onClose={() => { setCreating(false); reload(); }}
        />
      )}
    </>
  );
}

import { useCallback, useState } from 'react';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { usersApi } from '../../api/resources';
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
import useLookups from '../../hooks/useLookups';
import { useMeta } from '../../meta/MetaContext';
import { formatDate, labelize, toOptions } from '../../utils/format';

function userFields(meta, isEdit, minPassword, teams) {
  return [
    { name: 'name', label: 'Full name', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'role', label: 'Role', type: 'select', required: true, defaultValue: 'team_member', options: toOptions(meta?.roles) },
    { name: 'team_id', label: 'Team', type: 'select', numeric: true, options: teams },
    { name: 'job_title', label: 'Job title' },
    { name: 'weekly_capacity_hours', label: 'Weekly capacity (hours)', type: 'number', min: 0, max: 168, step: 'any',
      defaultValue: meta?.settings?.['capacity.default_weekly_hours'] ?? 40 },
    ...(isEdit ? [{ name: 'is_active', label: 'Active (can sign in)', type: 'switch' }] : []),
    {
      name: 'password', label: isEdit ? 'New password' : 'Password', type: 'password', minLength: minPassword,
      autoComplete: 'new-password',
      helperText: isEdit ? 'Leave blank to keep the current password. Changing it signs the user out.' : 'Leave blank for people who do not sign in.',
    },
  ];
}

/** Admin: people and accounts. */
export default function UsersPage() {
  const notify = useNotify();
  const { user: me } = useAuth();
  const { meta } = useMeta();
  const list = useListQuery({ sort: 'name', filters: ['role', 'is_active'] });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const minPassword = meta?.settings?.['auth.password_min_length'] || 8;
  const teams = useLookups(['teams'], Boolean(editing)).teams || [];

  const { query } = list;
  const loader = useCallback((signal) => usersApi.list(query, signal), [query]);
  const { data, error, loading, reload } = useApi(loader);

  const actions = (row) => (
    <Stack direction="row" spacing={0.5} onClick={(e) => e.stopPropagation()}>
      <Tooltip title="Edit"><IconButton size="small" aria-label={`Edit ${row.name}`} onClick={() => setEditing(row)}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
      {row.permissions.delete && row.id !== me.id && (
        <Tooltip title="Delete"><IconButton size="small" aria-label={`Delete ${row.name}`} onClick={() => setDeleting(row)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
      )}
    </Stack>
  );

  const columns = [
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 160 },
    { field: 'email', headerName: 'Email', flex: 1, minWidth: 200 },
    { field: 'role', headerName: 'Role', width: 150, renderCell: ({ value }) => <StatusChip value={value} /> },
    { field: 'team', headerName: 'Team', width: 150, valueGetter: (_v, row) => row.team_name || '—' },
    { field: 'job_title', headerName: 'Job title', width: 170, sortable: false },
    { field: 'is_active', headerName: 'Status', width: 110, sortable: false,
      renderCell: ({ value }) => <Chip size="small" label={value ? 'Active' : 'Inactive'} color={value ? 'success' : 'default'} variant="outlined" /> },
    { field: 'last_login_at', headerName: 'Last sign-in', width: 140, valueFormatter: (value) => formatDate(value) || 'Never' },
    { field: 'actions', headerName: '', width: 96, sortable: false, renderCell: ({ row }) => actions(row) },
  ];

  const handleSubmit = async (values) => {
    if (editing.id) {
      await usersApi.update(editing.id, values);
      notify('User updated');
    } else {
      await usersApi.create(values);
      notify('User created');
    }
    reload();
  };

  return (
    <>
      <PageHeader title="Users" subtitle="People, their roles and sign-in access."
        actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>New user</Button>} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <SearchField value={list.q} onChange={list.setSearch} label="Search name, email, title" />
        <TextField select label="Role" value={list.values.role} onChange={(e) => list.setFilter('role', e.target.value)} sx={{ minWidth: 170 }} fullWidth={false}>
          <MenuItem value="">All roles</MenuItem>
          {(meta?.roles || []).map((r) => <MenuItem key={r} value={r}>{labelize(r)}</MenuItem>)}
        </TextField>
        <TextField select label="Status" value={list.values.is_active} onChange={(e) => list.setFilter('is_active', e.target.value)} sx={{ minWidth: 140 }} fullWidth={false}>
          <MenuItem value="">All</MenuItem>
          <MenuItem value="true">Active</MenuItem>
          <MenuItem value="false">Inactive</MenuItem>
        </TextField>
      </Stack>
      <ResponsiveList
        rows={data?.data || []} total={data?.total || 0} loading={loading} error={error} columns={columns}
        page={list.page} pageSize={list.pageSize} sort={list.sort}
        onPageChange={list.setPage} onPageSizeChange={list.setPageSize} onSortChange={list.setSort}
        emptyText="No users match these filters."
        renderCard={(row) => (
          <Stack spacing={0.5}>
            <Stack direction="row" justifyContent="space-between"><Typography fontWeight={600}>{row.name}</Typography>{actions(row)}</Stack>
            <Typography variant="body2" color="text.secondary">{row.email}</Typography>
            <Stack direction="row" spacing={1}><StatusChip value={row.role} />{!row.is_active && <Chip size="small" label="Inactive" />}</Stack>
          </Stack>
        )}
      />
      {editing && (
        <FormDialog open title={editing.id ? `Edit ${editing.name}` : 'New user'} fields={userFields(meta, Boolean(editing.id), minPassword, teams)}
          initialValues={editing} submitLabel={editing.id ? 'Save' : 'Create'} onSubmit={handleSubmit} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <ConfirmDialog open title={`Delete ${deleting.name}?`}
          message="Only possible for people not referenced by projects or deliverables. Deactivating keeps their history."
          onConfirm={async () => { await usersApi.remove(deleting.id); notify('User deleted'); reload(); }}
          onClose={() => setDeleting(null)} />
      )}
    </>
  );
}

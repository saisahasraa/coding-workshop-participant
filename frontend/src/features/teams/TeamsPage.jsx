import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { teamsApi } from '../../api/resources';
import { useAuth } from '../../auth/AuthContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import FormDialog from '../../components/FormDialog';
import { useNotify } from '../../components/NotificationProvider';
import PageHeader from '../../components/PageHeader';
import ResponsiveList from '../../components/ResponsiveList';
import SearchField from '../../components/SearchField';
import useApi from '../../hooks/useApi';
import useListQuery from '../../hooks/useListQuery';
import useLookups from '../../hooks/useLookups';

const teamFields = (lookups) => [
  { name: 'name', label: 'Team name', required: true },
  { name: 'department_id', label: 'Department', type: 'select', numeric: true, required: true, options: lookups.departments || [] },
  {
    name: 'lead_id', label: 'Team lead', type: 'select', numeric: true, options: lookups.leads || [],
    helperText: 'Only people with the team lead role can lead a team.',
  },
];

/** Teams, their department and lead. Admins manage them; everyone can open a team. */
export default function TeamsPage() {
  const navigate = useNavigate();
  const notify = useNotify();
  const { can } = useAuth();
  const list = useListQuery({ sort: 'name' });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const lookups = useLookups(['departments', 'leads'], Boolean(editing));

  const { query } = list;
  const loader = useCallback((signal) => teamsApi.list(query, signal), [query]);
  const { data, error, loading, reload } = useApi(loader);

  const actions = (row) => (
    <Stack direction="row" spacing={0.5} onClick={(e) => e.stopPropagation()}>
      {row.permissions.update && <Tooltip title="Edit"><IconButton size="small" aria-label={`Edit ${row.name}`} onClick={() => setEditing(row)}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>}
      {row.permissions.delete && <Tooltip title="Delete"><IconButton size="small" aria-label={`Delete ${row.name}`} onClick={() => setDeleting(row)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>}
    </Stack>
  );

  const columns = [
    { field: 'name', headerName: 'Team', flex: 1, minWidth: 160 },
    { field: 'department', headerName: 'Department', width: 170, valueGetter: (_v, row) => row.department_name },
    { field: 'lead', headerName: 'Team lead', width: 180, valueGetter: (_v, row) => row.lead_name || '—' },
    { field: 'member_count', headerName: 'Members', width: 100, sortable: false },
    { field: 'actions', headerName: '', width: 96, sortable: false, renderCell: ({ row }) => actions(row) },
  ];

  return (
    <>
      <PageHeader
        title="Teams"
        subtitle="Who works together, who leads them, and how much capacity they have."
        actions={can('teams', 'create') && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>New team</Button>}
      />
      <Stack direction="row" sx={{ mb: 2 }}><SearchField value={list.q} onChange={list.setSearch} label="Search teams" /></Stack>
      <ResponsiveList
        rows={data?.data || []} total={data?.total || 0} loading={loading} error={error} columns={columns}
        page={list.page} pageSize={list.pageSize} sort={list.sort}
        onPageChange={list.setPage} onPageSizeChange={list.setPageSize} onSortChange={list.setSort}
        onRowClick={(row) => navigate(`/teams/${row.id}`)}
        emptyText="No teams yet."
        renderCard={(row) => (
          <Stack
            direction="row"
            sx={{
              justifyContent: "space-between",
              alignItems: "flex-start"
            }}>
            <div>
              <Typography sx={{
                fontWeight: 600
              }}>{row.name}</Typography>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>{row.department_name} · {row.lead_name || 'No lead'} · {row.member_count} members</Typography>
            </div>
            {actions(row)}
          </Stack>
        )}
      />
      {editing && (
        <FormDialog
          open
          title={editing.id ? `Edit ${editing.name}` : 'New team'}
          fields={teamFields(lookups)}
          initialValues={editing}
          submitLabel={editing.id ? 'Save' : 'Create'}
          onSubmit={async (values) => {
            if (editing.id) await teamsApi.update(editing.id, values); else await teamsApi.create(values);
            notify(editing.id ? 'Team updated' : 'Team created');
            reload();
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          title={`Delete ${deleting.name}?`}
          message="Members stay in the system but are no longer part of a team."
          onConfirm={async () => { await teamsApi.remove(deleting.id); notify('Team deleted'); reload(); }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

import { useCallback, useState } from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { departmentsApi } from '../../api/resources';
import ConfirmDialog from '../../components/ConfirmDialog';
import FormDialog from '../../components/FormDialog';
import { useNotify } from '../../components/NotificationProvider';
import PageHeader from '../../components/PageHeader';
import ResponsiveList from '../../components/ResponsiveList';
import SearchField from '../../components/SearchField';
import useApi from '../../hooks/useApi';
import useListQuery from '../../hooks/useListQuery';

const FIELDS = [
  { name: 'name', label: 'Name', required: true },
  { name: 'code', label: 'Code', required: true, helperText: 'Up to 10 characters, e.g. ENG' },
  { name: 'description', label: 'Description', type: 'textarea' },
];

/** Admin: departments. */
export default function DepartmentsPage() {
  const notify = useNotify();
  const list = useListQuery({ sort: 'name' });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const { query } = list;
  const loader = useCallback((signal) => departmentsApi.list(query, signal), [query]);
  const { data, error, loading, reload } = useApi(loader);

  const actions = (row) => (
    <Stack direction="row" spacing={0.5}>
      <Tooltip title="Edit"><IconButton size="small" aria-label={`Edit ${row.name}`} onClick={() => setEditing(row)}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
      <Tooltip title="Delete"><IconButton size="small" aria-label={`Delete ${row.name}`} onClick={() => setDeleting(row)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
    </Stack>
  );

  const columns = [
    { field: 'code', headerName: 'Code', width: 110 },
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 160 },
    { field: 'description', headerName: 'Description', flex: 2, minWidth: 200, sortable: false },
    { field: 'project_count', headerName: 'Projects', width: 110, sortable: false },
    { field: 'actions', headerName: '', width: 96, sortable: false, renderCell: ({ row }) => actions(row) },
  ];

  return (
    <>
      <PageHeader title="Departments" subtitle="Organizational units that own projects."
        actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>New department</Button>} />
      <Stack direction="row" sx={{ mb: 2 }}><SearchField value={list.q} onChange={list.setSearch} label="Search departments" /></Stack>
      <ResponsiveList
        rows={data?.data || []} total={data?.total || 0} loading={loading} error={error} columns={columns}
        page={list.page} pageSize={list.pageSize} sort={list.sort}
        onPageChange={list.setPage} onPageSizeChange={list.setPageSize} onSortChange={list.setSort}
        renderCard={(row) => (
          <Stack direction="row" sx={{
            justifyContent: "space-between"
          }}>
            <div><Typography sx={{
              fontWeight: 600
            }}>{row.code} · {row.name}</Typography><Typography variant="body2" sx={{
              color: "text.secondary"
            }}>{row.project_count} projects</Typography></div>
            {actions(row)}
          </Stack>
        )}
      />
      {editing && (
        <FormDialog open title={editing.id ? `Edit ${editing.name}` : 'New department'} fields={FIELDS} initialValues={editing}
          submitLabel={editing.id ? 'Save' : 'Create'}
          onSubmit={async (values) => {
            if (editing.id) await departmentsApi.update(editing.id, values); else await departmentsApi.create(values);
            notify(editing.id ? 'Department updated' : 'Department created');
            reload();
          }}
          onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <ConfirmDialog open title={`Delete ${deleting.name}?`} message="Departments that still own projects cannot be deleted."
          onConfirm={async () => { await departmentsApi.remove(deleting.id); notify('Department deleted'); reload(); }}
          onClose={() => setDeleting(null)} />
      )}
    </>
  );
}

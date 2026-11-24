import { useCallback, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { expensesApi, fetchBudget } from '../../api/resources';
import { useAuth } from '../../auth/AuthContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import FormDialog from '../../components/FormDialog';
import { useNotify } from '../../components/NotificationProvider';
import ResponsiveList from '../../components/ResponsiveList';
import StatTile from '../../components/StatTile';
import StatusChip from '../../components/StatusChip';
import useApi from '../../hooks/useApi';
import useListQuery from '../../hooks/useListQuery';
import { useMeta } from '../../meta/MetaContext';
import { formatDate, formatMoney, labelize } from '../../utils/format';
import expenseFields from './expenseFields';

/** A horizontal bar for one slice of spending. */
function Slice({ label, amount, total, currency }) {
  const pct = total > 0 ? (amount / total) * 100 : 0;
  return (
    <div>
      <Stack direction="row" justifyContent="space-between"><Typography variant="body2">{label}</Typography><Typography variant="body2">{formatMoney(amount, currency)}</Typography></Stack>
      <LinearProgress variant="determinate" value={pct} aria-label={`${label}: ${Math.round(pct)}% of spending`} sx={{ height: 6, borderRadius: 3 }} />
    </div>
  );
}

Slice.propTypes = {
  label: PropTypes.string.isRequired, amount: PropTypes.number.isRequired, total: PropTypes.number.isRequired, currency: PropTypes.string.isRequired,
};

/** Spending against the planned budget, set beside how much of the work is done. */
function BurnVersusProgress({ burn, progress }) {
  const over = burn !== null && burn > 100;
  return (
    <Card sx={{ height: '100%' }}><CardContent>
      <Typography variant="h3" gutterBottom>Spending vs progress</Typography>
      <Stack spacing={1.5}>
        <div>
          <Stack direction="row" justifyContent="space-between"><Typography variant="body2">Budget spent</Typography><Typography variant="body2" color={over ? 'error' : 'inherit'}>{burn === null ? 'No budget planned' : `${burn}%`}</Typography></Stack>
          <LinearProgress variant="determinate" value={Math.min(burn ?? 0, 100)} color={over ? 'error' : 'primary'} aria-label="Budget spent" sx={{ height: 8, borderRadius: 4 }} />
        </div>
        <div>
          <Stack direction="row" justifyContent="space-between"><Typography variant="body2">Work complete</Typography><Typography variant="body2">{progress}%</Typography></Stack>
          <LinearProgress variant="determinate" value={progress} color="success" aria-label="Work complete" sx={{ height: 8, borderRadius: 4 }} />
        </div>
      </Stack>
    </CardContent></Card>
  );
}

BurnVersusProgress.propTypes = { burn: PropTypes.number, progress: PropTypes.number.isRequired };

/** Project → Budget: figures, where the money went, and the expense list. */
export default function BudgetTab({ project, onChange }) {
  const notify = useNotify();
  const { can } = useAuth();
  const { meta, currency } = useMeta();
  const list = useListQuery({ sort: '-spent_on', filters: ['category'] });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const categories = meta?.settings?.['budget.expense_categories'] || [];
  const canAdd = can('expenses', 'create') && project.permissions.update;

  const reportLoader = useCallback((signal) => fetchBudget({ project_id: project.key }, signal), [project.key]);
  const report = useApi(reportLoader);
  const { query } = list;
  const expenseQuery = useMemo(() => ({ ...query, project_id: project.id }), [query, project.id]);
  const listLoader = useCallback((signal) => expensesApi.list(expenseQuery, signal), [expenseQuery]);
  const expenses = useApi(listLoader);

  const refresh = () => { report.reload(); expenses.reload(); onChange?.(); };
  const figures = report.data?.data[0];
  const totals = report.data?.totals;
  const spentTotal = totals?.spent || 0;

  const actions = (row) => (
    <Stack direction="row" spacing={0.5}>
      {row.permissions.update && (
        <Tooltip title="Edit"><IconButton size="small" aria-label={`Edit ${labelize(row.category)} expense of ${row.amount}`} onClick={() => setEditing(row)}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
      )}
      {row.permissions.delete && (
        <Tooltip title="Delete"><IconButton size="small" aria-label={`Delete ${labelize(row.category)} expense of ${row.amount}`} onClick={() => setDeleting(row)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
      )}
    </Stack>
  );

  const columns = [
    { field: 'spent_on', headerName: 'Date', width: 130, valueFormatter: (value) => formatDate(value) },
    { field: 'category', headerName: 'Category', width: 130, renderCell: ({ value }) => <StatusChip value={value} /> },
    { field: 'amount', headerName: 'Amount', width: 130, type: 'number', valueFormatter: (value) => formatMoney(Number(value), currency) },
    { field: 'description', headerName: 'Description', flex: 1, minWidth: 180, sortable: false },
    { field: 'created_by_name', headerName: 'Recorded by', width: 150, sortable: false },
    { field: 'actions', headerName: '', width: 96, sortable: false, renderCell: ({ row }) => actions(row) },
  ];

  return (
    <Stack spacing={2}>
      {report.error && <Alert severity="error">{report.error.message}</Alert>}
      {figures && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 6, md: 3 }}><StatTile label="Planned" value={formatMoney(figures.planned_budget, currency)} /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><StatTile label="Spent" value={formatMoney(figures.spent, currency)} /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><StatTile label="Remaining" value={formatMoney(figures.remaining, currency)} tone={figures.remaining < 0 ? 'error' : undefined} /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><StatTile label="Expenses" value={expenses.data?.total ?? 0} /></Grid>
          <Grid size={{ xs: 12, md: 4 }}><BurnVersusProgress burn={figures.burn_pct} progress={figures.progress_pct} /></Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <Card sx={{ height: '100%' }}><CardContent>
              <Typography variant="h3" gutterBottom>By category</Typography>
              <Stack spacing={1.5}>
                {report.data.by_category.length === 0 && <Typography color="text.secondary">Nothing spent yet.</Typography>}
                {report.data.by_category.map((c) => <Slice key={c.category} label={labelize(c.category)} amount={c.amount} total={spentTotal} currency={currency} />)}
              </Stack>
            </CardContent></Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <Card sx={{ height: '100%' }}><CardContent>
              <Typography variant="h3" gutterBottom>By month</Typography>
              <Stack spacing={1.5}>
                {report.data.by_month.length === 0 && <Typography color="text.secondary">Nothing spent yet.</Typography>}
                {report.data.by_month.map((m) => <Slice key={m.month} label={m.month} amount={m.amount} total={spentTotal} currency={currency} />)}
              </Stack>
            </CardContent></Card>
          </Grid>
        </Grid>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between">
        <TextField select label="Category" value={list.values.category} onChange={(e) => list.setFilter('category', e.target.value)} sx={{ minWidth: 180 }} fullWidth={false}>
          <MenuItem value="">All categories</MenuItem>
          {categories.map((c) => <MenuItem key={c} value={c}>{labelize(c)}</MenuItem>)}
        </TextField>
        {canAdd && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({})}>Add expense</Button>}
      </Stack>

      <ResponsiveList
        rows={expenses.data?.data || []} total={expenses.data?.total || 0} loading={expenses.loading} error={expenses.error} columns={columns}
        page={list.page} pageSize={list.pageSize} sort={list.sort}
        onPageChange={list.setPage} onPageSizeChange={list.setPageSize} onSortChange={list.setSort}
        emptyText="No expenses recorded."
        renderCard={(row) => (
          <Stack spacing={0.5}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
              <Typography fontWeight={600}>{formatMoney(Number(row.amount), currency)}</Typography>
              {actions(row)}
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center"><StatusChip value={row.category} /><Typography variant="body2" color="text.secondary">{formatDate(row.spent_on)}</Typography></Stack>
            {row.description && <Typography variant="body2">{row.description}</Typography>}
          </Stack>
        )}
      />

      {editing && (
        <FormDialog
          open
          title={editing.id ? 'Edit expense' : 'Add expense'}
          fields={expenseFields(categories)}
          initialValues={editing}
          editableFields={editing.id ? editing.permissions.editable_fields : null}
          submitLabel={editing.id ? 'Save' : 'Add'}
          onSubmit={async (values) => {
            if (editing.id) await expensesApi.update(editing.id, values);
            else await expensesApi.create({ ...values, project_id: project.id });
            notify(editing.id ? 'Expense updated' : 'Expense added');
            refresh();
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          title="Delete expense?"
          message={`${formatMoney(Number(deleting.amount), currency)} on ${formatDate(deleting.spent_on)} will be removed from ${project.key}.`}
          onConfirm={async () => { await expensesApi.remove(deleting.id); notify('Expense deleted'); refresh(); }}
          onClose={() => setDeleting(null)}
        />
      )}
    </Stack>
  );
}

BudgetTab.propTypes = {
  project: PropTypes.shape({
    id: PropTypes.number.isRequired,
    key: PropTypes.string.isRequired,
    permissions: PropTypes.shape({ update: PropTypes.bool, editable_fields: PropTypes.array }).isRequired,
  }).isRequired,
  /** Called after any change, so the page can refresh the project's own figures and health. */
  onChange: PropTypes.func,
};

import { useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { fetchBudget } from '../../api/resources';
import HealthChip from '../../components/HealthChip';
import PageHeader from '../../components/PageHeader';
import StatTile from '../../components/StatTile';
import StatusChip from '../../components/StatusChip';
import useApi from '../../hooks/useApi';
import useLookups from '../../hooks/useLookups';
import { useMeta } from '../../meta/MetaContext';
import { formatMoney, labelize } from '../../utils/format';
import UtilizationBar from '../capacity/UtilizationBar';

function Money({ value, currency, tone }) {
  return <Typography component="span" variant="body2" color={tone}>{formatMoney(value, currency)}</Typography>;
}

Money.propTypes = { value: PropTypes.number.isRequired, currency: PropTypes.string.isRequired, tone: PropTypes.string };

/** Planned vs spent for every project the user can see, worst burn first. */
export default function BudgetPage() {
  const { currency } = useMeta();
  const [params, setParams] = useSearchParams();
  const lookups = useLookups(['departments'], true);
  const departmentId = params.get('department_id') || '';

  const query = useMemo(() => ({ department_id: departmentId }), [departmentId]);
  const loader = useCallback((signal) => fetchBudget(query, signal), [query]);
  const { data, error, loading } = useApi(loader);
  const rows = useMemo(() => [...(data?.data || [])].sort((a, b) => (b.burn_pct ?? -1) - (a.burn_pct ?? -1) || a.key.localeCompare(b.key)), [data]);
  const totals = data?.totals;

  return (
    <>
      <PageHeader title="Budget" subtitle="Planned budget against spending, project by project." />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField select label="Department" value={departmentId} sx={{ minWidth: 220 }} fullWidth={false}
          onChange={(e) => setParams(e.target.value ? { department_id: e.target.value } : {}, { replace: true })}>
          <MenuItem value="">All departments</MenuItem>
          {(lookups.departments || []).map((d) => <MenuItem key={d.value} value={String(d.value)}>{d.label}</MenuItem>)}
        </TextField>
      </Stack>
      {loading && <LinearProgress aria-label="Loading budget" sx={{ mb: 2 }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error.message}</Alert>}

      {totals && (
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid size={{ xs: 6, md: 3 }}><StatTile label="Planned" value={formatMoney(totals.planned_budget, currency)} /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><StatTile label="Spent" value={formatMoney(totals.spent, currency)} hint={totals.burn_pct === null ? undefined : `${totals.burn_pct}% of planned`} /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><StatTile label="Remaining" value={formatMoney(totals.remaining, currency)} tone={totals.remaining < 0 ? 'error' : undefined} /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><StatTile label="Over budget" value={totals.over_budget} tone={totals.over_budget ? 'error' : undefined} hint="projects" /></Grid>
        </Grid>
      )}

      {data && !rows.length && <Typography sx={{
        color: "text.secondary"
      }}>No projects match.</Typography>}
      {rows.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="Budget by project">
            <TableHead>
              <TableRow>
                <TableCell>Project</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Planned</TableCell>
                <TableCell align="right">Spent</TableCell>
                <TableCell align="right">Remaining</TableCell>
                <TableCell sx={{ minWidth: 150 }}>Budget spent</TableCell>
                <TableCell>Progress</TableCell>
                <TableCell>Health</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id} hover>
                  <TableCell>
                    <Link component={RouterLink} to={`/projects/${p.key}?tab=budget`} underline="hover" sx={{
                      fontWeight: 600
                    }}>{p.key}</Link>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{p.name}</Typography>
                  </TableCell>
                  <TableCell><StatusChip value={p.status} /></TableCell>
                  <TableCell align="right"><Money value={p.planned_budget} currency={currency} /></TableCell>
                  <TableCell align="right"><Money value={p.spent} currency={currency} /></TableCell>
                  <TableCell align="right"><Money value={p.remaining} currency={currency} tone={p.remaining < 0 ? 'error' : undefined} /></TableCell>
                  <TableCell><UtilizationBar value={p.burn_pct} over={p.over_budget} unit="of budget spent" /></TableCell>
                  <TableCell>{p.progress_pct}%</TableCell>
                  <TableCell><HealthChip level={p.health} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {data?.by_category.length > 0 && (
        <Stack spacing={1} sx={{ mt: 3 }}>
          <Typography variant="h3">Spending by category</Typography>
          <Stack direction="row" spacing={3} useFlexGap sx={{
            flexWrap: "wrap"
          }}>
            {data.by_category.map((c) => (
              <div key={c.category}>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>{labelize(c.category)}</Typography>
                <Typography sx={{
                  fontWeight: 600
                }}>{formatMoney(c.amount, currency)}</Typography>
              </div>
            ))}
          </Stack>
        </Stack>
      )}
    </>
  );
}

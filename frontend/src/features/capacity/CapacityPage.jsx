import { useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { useSearchParams } from 'react-router-dom';
import { useMediaQuery } from 'react-responsive';
import Alert from '@mui/material/Alert';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { fetchCapacity } from '../../api/resources';
import PageHeader from '../../components/PageHeader';
import StatTile from '../../components/StatTile';
import useApi from '../../hooks/useApi';
import useLookups from '../../hooks/useLookups';
import { formatDate } from '../../utils/format';
import UtilizationBar from './UtilizationBar';

const FILTERS = ['from', 'to', 'team_id', 'department_id'];

function Status({ row }) {
  if (row.over_allocated) return <Chip size="small" color="error" label="Over-allocated" />;
  if (row.available_hours === 0) return <Chip size="small" variant="outlined" label="No availability" />;
  return <Chip size="small" color="success" variant="outlined" label={`${Math.max(row.free_hours, 0)} h free`} />;
}

Status.propTypes = { row: PropTypes.object.isRequired };

function Projects({ row }) {
  if (!row.projects.length && !row.uncounted_count) return <Typography variant="body2" color="text.secondary">No assigned work</Typography>;
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {row.projects.map((p) => <Chip key={p.project_id ?? 'other'} size="small" variant="outlined" label={`${p.key || 'Other'} · ${p.hours} h`} />)}
      {row.uncounted_count > 0 && (
        <Tooltip title="Open deliverables without an estimate or a due date cannot be counted. Add both to include them.">
          <Chip size="small" color="warning" variant="outlined" label={`${row.uncounted_count} not counted`} />
        </Tooltip>
      )}
    </Stack>
  );
}

Projects.propTypes = { row: PropTypes.object.isRequired };

/**
 * Who has capacity, who is stretched, and on which projects. Allocated hours are the remaining estimates of each
 * person's unfinished deliverables, reserved up to their deadlines, so reassigning work moves the load.
 */
export default function CapacityPage() {
  const [params, setParams] = useSearchParams();
  const isMobile = useMediaQuery({ maxWidth: 899 });
  const lookups = useLookups(['teams', 'departments'], true);
  const values = Object.fromEntries(FILTERS.map((name) => [name, params.get(name) || '']));

  const setFilter = (name, value) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (value) next.set(name, value); else next.delete(name);
    return next;
  }, { replace: true });

  const { from, to, team_id: teamId, department_id: departmentId } = values;
  const query = useMemo(() => ({ from, to, team_id: teamId, department_id: departmentId }), [from, to, teamId, departmentId]);
  const loader = useCallback((signal) => fetchCapacity(query, signal), [query]);
  const { data, error, loading } = useApi(loader);

  const rows = useMemo(() => [...(data?.data || [])].sort(
    (a, b) => Number(b.over_allocated) - Number(a.over_allocated) || (b.utilization_pct ?? -1) - (a.utilization_pct ?? -1),
  ), [data]);
  const summary = data?.summary;

  return (
    <>
      <PageHeader
        title="Capacity"
        subtitle={data
          ? `${formatDate(data.from)} – ${formatDate(data.to)} · allocated = hours reserved before each deliverable's deadline · over-allocated above ${data.threshold_pct}% of availability`
          : 'Availability and assigned work across people.'}
      />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField label="From" type="date" value={values.from} onChange={(e) => setFilter('from', e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }} helperText={values.from ? '' : 'Default: today'} fullWidth={false} />
        <TextField label="To" type="date" value={values.to} onChange={(e) => setFilter('to', e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }} helperText={values.to ? '' : 'Default: 4 weeks'} fullWidth={false} />
        <TextField select label="Team" value={values.team_id} onChange={(e) => setFilter('team_id', e.target.value)} sx={{ minWidth: 190 }} fullWidth={false}>
          <MenuItem value="">All teams</MenuItem>
          {(lookups.teams || []).map((t) => <MenuItem key={t.value} value={String(t.value)}>{t.label}</MenuItem>)}
        </TextField>
        <TextField select label="Department" value={values.department_id} onChange={(e) => setFilter('department_id', e.target.value)} sx={{ minWidth: 190 }} fullWidth={false}>
          <MenuItem value="">All departments</MenuItem>
          {(lookups.departments || []).map((d) => <MenuItem key={d.value} value={String(d.value)}>{d.label}</MenuItem>)}
        </TextField>
      </Stack>
      {loading && <LinearProgress aria-label="Loading capacity" sx={{ mb: 2 }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error.details ? Object.values(error.details).join('; ') : error.message}</Alert>}

      {summary && (
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid size={{ xs: 6, md: 3 }}><StatTile label="People" value={summary.people} /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><StatTile label="Available hours" value={summary.available_hours} /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><StatTile label="Allocated hours" value={summary.allocated_hours} /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><StatTile label="Over-allocated" value={summary.over_allocated} tone={summary.over_allocated ? 'error' : undefined} /></Grid>
        </Grid>
      )}

      {data && !rows.length && <Typography color="text.secondary">No one matches these filters.</Typography>}
      {isMobile ? (
        <Stack spacing={1.5} component="ul" sx={{ p: 0, m: 0, listStyle: 'none' }}>
          {rows.map((row) => (
            <Card key={row.user_id} component="li"><CardContent>
              <Stack spacing={1}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <div><Typography fontWeight={600}>{row.name}</Typography><Typography variant="body2" color="text.secondary">{row.team_name || 'No team'}</Typography></div>
                  <Status row={row} />
                </Stack>
                <UtilizationBar value={row.utilization_pct} over={row.over_allocated} />
                <Typography variant="body2" color="text.secondary">{row.allocated_hours} of {row.available_hours} h available{row.leave_days ? ` · ${row.leave_days} leave day(s)` : ''}</Typography>
                <Projects row={row} />
              </Stack>
            </CardContent></Card>
          ))}
        </Stack>
      ) : (
        !!rows.length && (
          <Card>
            <TableContainer>
              <Table size="small" aria-label="Capacity by person">
                <TableHead>
                  <TableRow>
                    <TableCell>Person</TableCell><TableCell align="right">Capacity (h)</TableCell><TableCell align="right">Leave (h)</TableCell>
                    <TableCell align="right">Available (h)</TableCell><TableCell align="right">Allocated (h)</TableCell>
                    <TableCell sx={{ minWidth: 170 }}>Utilization</TableCell><TableCell>Status</TableCell><TableCell>Projects</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.user_id} hover>
                      <TableCell><Typography fontWeight={600}>{row.name}</Typography><Typography variant="body2" color="text.secondary">{row.team_name || 'No team'}</Typography></TableCell>
                      <TableCell align="right">{row.capacity_hours}</TableCell>
                      <TableCell align="right">{row.leave_hours}</TableCell>
                      <TableCell align="right">{row.available_hours}</TableCell>
                      <TableCell align="right">{row.allocated_hours}</TableCell>
                      <TableCell><UtilizationBar value={row.utilization_pct} over={row.over_allocated} /></TableCell>
                      <TableCell><Status row={row} /></TableCell>
                      <TableCell><Projects row={row} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        )
      )}
    </>
  );
}

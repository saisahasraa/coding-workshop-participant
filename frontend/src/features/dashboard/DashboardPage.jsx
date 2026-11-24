import PropTypes from 'prop-types';
import { Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { fetchSummary } from '../../api/resources';
import { useAuth } from '../../auth/AuthContext';
import BarRow from '../../components/BarRow';
import HealthChip from '../../components/HealthChip';
import PageHeader from '../../components/PageHeader';
import StatTile from '../../components/StatTile';
import useApi from '../../hooks/useApi';
import { useMeta } from '../../meta/MetaContext';
import { formatDate, formatMoney, labelize } from '../../utils/format';
import { HEALTH } from '../../utils/health';
import UtilizationBar from '../capacity/UtilizationBar';

function Panel({ title, to, linkLabel, children }) {
  return (
    <Card sx={{ height: '100%' }}><CardContent>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 1.5 }}>
        <Typography variant="h3">{title}</Typography>
        {to && <Link component={RouterLink} to={to} variant="body2" underline="hover">{linkLabel}</Link>}
      </Stack>
      {children}
    </CardContent></Card>
  );
}

Panel.propTypes = { title: PropTypes.string.isRequired, to: PropTypes.string, linkLabel: PropTypes.string, children: PropTypes.node };

const none = (text) => <Typography color="text.secondary">{text}</Typography>;

function NeedsAttention({ items }) {
  if (!items.length) return none('No running project is at risk.');
  return (
    <Stack component="ul" spacing={1.5} sx={{ p: 0, m: 0, listStyle: 'none' }}>
      {items.map((p) => (
        <li key={p.id}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Link component={RouterLink} to={`/projects/${p.key}`} fontWeight={600} underline="hover">{p.key}</Link>
            <Typography>{p.name}</Typography>
            <HealthChip level={p.health} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {p.health_reasons[0]?.message}{p.health_reasons.length > 1 && ` (+${p.health_reasons.length - 1} more)`}
            {' · '}{p.manager_name}{p.end_date && ` · ends ${formatDate(p.end_date)}`}
          </Typography>
        </li>
      ))}
    </Stack>
  );
}

NeedsAttention.propTypes = { items: PropTypes.array.isRequired };

/** The home page: how the portfolio is doing, and what needs attention. */
export default function DashboardPage() {
  const { user } = useAuth();
  const { currency } = useMeta();
  const { data, error } = useApi(fetchSummary);

  if (error && !data) return <Alert severity="error">{error.message}</Alert>;
  if (!data) return <LinearProgress aria-label="Loading dashboard" />;

  const { projects, deliverables: work, budget, capacity, mine } = data;
  const atRisk = projects.by_health.amber + projects.by_health.red;
  const statuses = Object.entries(work.by_status);
  const mostWork = Math.max(...statuses.map(([, n]) => n), 1);

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`Welcome, ${user.name}. Here is how things stand.`} />
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 4, lg: 'grow' }}><StatTile label="Running projects" value={projects.running} hint={`${projects.total} in total`} /></Grid>
        <Grid size={{ xs: 6, md: 4, lg: 'grow' }}><StatTile label="At risk or off track" value={atRisk} tone={atRisk ? 'error' : undefined} hint={`${projects.by_health.red} off track`} /></Grid>
        <Grid size={{ xs: 6, md: 4, lg: 'grow' }}><StatTile label="Overdue deliverables" value={work.overdue} tone={work.overdue ? 'error' : undefined} hint={`${work.due_soon} due in ${work.due_soon_days} days`} /></Grid>
        <Grid size={{ xs: 6, md: 4, lg: 'grow' }}><StatTile label="Over-allocated people" value={capacity.over_allocated} tone={capacity.over_allocated ? 'error' : undefined} hint={`of ${capacity.people}`} /></Grid>
        <Grid size={{ xs: 12, md: 4, lg: 'grow' }}>
          <StatTile label="Budget spent" value={budget.burn_pct === null ? '—' : `${budget.burn_pct}%`} tone={budget.over_budget ? 'error' : undefined}
            hint={`${formatMoney(budget.spent, currency)} of ${formatMoney(budget.planned_budget, currency)}`} />
        </Grid>

        <Grid size={{ xs: 12, lg: 7 }}>
          <Panel title="Needs attention" to="/projects?health=amber%2Cred" linkLabel="All at-risk projects">
            <NeedsAttention items={data.needs_attention} />
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Panel title="Project health" to="/projects" linkLabel="All projects">
            <Stack spacing={1.5}>
              {Object.entries(HEALTH).map(([level, { label, color }]) => (
                <BarRow key={level} label={label} value={projects.by_health[level]} max={projects.running} color={color}
                  to={`/projects?health=${level}`} />
              ))}
              {projects.running === 0 && none('No project is running yet.')}
            </Stack>
          </Panel>
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <Panel title="Deliverables by status" to="/deliverables" linkLabel="All deliverables">
            <Stack spacing={1.5}>
              {statuses.map(([status, n]) => <BarRow key={status} label={labelize(status)} value={n} max={mostWork} />)}
              <Typography variant="body2" color="text.secondary">
                {work.unassigned} without an owner · in projects that are still running
              </Typography>
            </Stack>
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <Panel title="Budget spent by project" to="/budget" linkLabel="Budget">
            <Stack spacing={1.5}>
              {budget.top.length === 0 && none('No running project has a budget yet.')}
              {budget.top.map((p) => (
                <div key={p.id}>
                  <Stack direction="row" justifyContent="space-between">
                    <Link component={RouterLink} to={`/projects/${p.key}?tab=budget`} variant="body2" underline="hover" color="inherit">{p.key} · {p.name}</Link>
                    <Typography variant="body2" color="text.secondary">{formatMoney(p.spent, currency)}</Typography>
                  </Stack>
                  <UtilizationBar value={p.burn_pct} over={p.over_budget} unit="of budget spent" />
                </div>
              ))}
            </Stack>
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, md: 12, lg: 4 }}>
          <Panel title="Workload" to="/capacity" linkLabel="Capacity">
            <Stack spacing={1.5}>
              {capacity.top.length === 0 && none('Nobody has assigned work in this period.')}
              {capacity.top.map((p) => (
                <div key={p.user_id}>
                  <Typography variant="body2">{p.name}</Typography>
                  <UtilizationBar value={p.utilization_pct} over={p.over_allocated} />
                </div>
              ))}
              <Typography variant="body2" color="text.secondary">
                {formatDate(capacity.from)} – {formatDate(capacity.to)}
              </Typography>
            </Stack>
          </Panel>
        </Grid>

        {user.role !== 'viewer' && (
          <Grid size={12}>
            <Panel title="My work">
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ sm: 'center' }}>
                <Typography><b>{mine.open}</b> open</Typography>
                <Typography color={mine.overdue ? 'error' : 'inherit'}><b>{mine.overdue}</b> overdue</Typography>
                <Typography><b>{mine.due_soon}</b> due in {work.due_soon_days} days</Typography>
                <Button component={RouterLink} to="/my-work" variant="outlined" sx={{ ml: { sm: 'auto' } }}>Open my work</Button>
              </Stack>
            </Panel>
          </Grid>
        )}
      </Grid>
    </>
  );
}

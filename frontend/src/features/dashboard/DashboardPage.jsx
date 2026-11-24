import PropTypes from 'prop-types';
import { Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import { fetchSummary } from '../../api/resources';
import { useAuth } from '../../auth/AuthContext';
import BarRow from '../../components/BarRow';
import HealthChip from '../../components/HealthChip';
import PageHeader from '../../components/PageHeader';
import PersonLink from '../../components/PersonLink';
import StatTile from '../../components/StatTile';
import useApi from '../../hooks/useApi';
import { useMeta } from '../../meta/MetaContext';
import { formatDate, formatMoney, labelize } from '../../utils/format';
import { HEALTH } from '../../utils/health';
import { avatarColor, initials } from '../../utils/people';
import UtilizationBar from '../capacity/UtilizationBar';

/** A titled card; `span` is how many of the 12 dashboard columns it takes on wide screens. */
function Panel({ title, to, linkLabel, span, children }) {
  return (
    <Card component="section" aria-label={title} sx={{ gridColumn: { xs: '1 / -1', lg: `span ${span}` }, p: 2.5, minWidth: 0 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2, mb: 2 }}>
        <Typography variant="h3">{title}</Typography>
        {to && <Link component={RouterLink} to={to} variant="body2" underline="hover" sx={{ whiteSpace: 'nowrap' }}>{linkLabel}</Link>}
      </Box>
      {children}
    </Card>
  );
}

Panel.propTypes = {
  title: PropTypes.string.isRequired, to: PropTypes.string, linkLabel: PropTypes.string, span: PropTypes.number.isRequired, children: PropTypes.node,
};

const none = (text) => <Typography sx={{
  color: "text.secondary"
}}>{text}</Typography>;

function NeedsAttention({ items }) {
  if (!items.length) return none('No running project is at risk.');
  return (
    <Stack component="ul" divider={<Box component="li" aria-hidden sx={{ borderTop: 1, borderColor: 'divider', listStyle: 'none' }} />} spacing={1.5} sx={{ p: 0, m: 0, listStyle: 'none' }}>
      {items.map((p) => (
        <Box component="li" key={p.id} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ overflowWrap: 'anywhere' }}>
              <Link component={RouterLink} to={`/projects/${p.key}`} underline="hover" sx={{
                fontWeight: 700
              }}>{p.key}</Link>{' '}{p.name}
            </Typography>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              {p.health_reasons[0]?.message}{p.health_reasons.length > 1 && ` (+${p.health_reasons.length - 1} more)`}
            </Typography>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              {p.manager_name}{p.end_date && ` · ends ${formatDate(p.end_date)}`} · {p.progress_pct}% complete
            </Typography>
          </Box>
          <HealthChip level={p.health} />
        </Box>
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
      <PageHeader
        title="Dashboard"
        subtitle={`Welcome, ${user.name}. Here is how things stand.`}
        actions={user.role !== 'viewer' && <Button component={RouterLink} to="/my-work" variant="outlined">Open my work</Button>}
      />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', mb: 2 }}>
        <StatTile label="Running projects" value={projects.running} hint={`${projects.total} in total`} icon={<AccountTreeOutlinedIcon />} to="/projects?status=active" />
        <StatTile label="At risk or off track" value={atRisk} tone={atRisk ? 'error' : 'success'} hint={`${projects.by_health.red} off track`}
          icon={<WarningAmberOutlinedIcon />} to="/projects?health=amber%2Cred" />
        <StatTile label="Overdue deliverables" value={work.overdue} tone={work.overdue ? 'error' : 'success'} hint={`${work.due_soon} due in ${work.due_soon_days} days`}
          icon={<EventBusyOutlinedIcon />} to="/deliverables?overdue=true" />
        <StatTile label="Over-allocated people" value={capacity.over_allocated} tone={capacity.over_allocated ? 'error' : 'success'} hint={`of ${capacity.people} people`}
          icon={<GroupsOutlinedIcon />} to="/capacity" />
        <StatTile label="Budget spent" value={budget.burn_pct === null ? '—' : `${budget.burn_pct}%`} tone={budget.over_budget ? 'error' : undefined}
          hint={`${formatMoney(budget.spent, currency)} of ${formatMoney(budget.planned_budget, currency)}`} icon={<AccountBalanceWalletOutlinedIcon />} to="/budget" />
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'repeat(12, 1fr)' } }}>
        <Panel title="Needs attention" to="/projects?health=amber%2Cred" linkLabel="All at-risk projects" span={7}>
          <NeedsAttention items={data.needs_attention} />
        </Panel>
        <Panel title="Project health" to="/projects" linkLabel="All projects" span={5}>
          <Stack spacing={2}>
            {Object.entries(HEALTH).map(([level, { label, color }]) => (
              <BarRow key={level} label={label} value={projects.by_health[level]} max={projects.running} color={color} to={`/projects?health=${level}`} />
            ))}
            {projects.running === 0 && none('No project is running yet.')}
          </Stack>
        </Panel>

        <Panel title="Deliverables by status" to="/deliverables" linkLabel="All deliverables" span={4}>
          <Stack spacing={2}>
            {statuses.map(([status, n]) => <BarRow key={status} label={labelize(status)} value={n} max={mostWork} to={`/deliverables?status=${status}`} />)}
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              {work.unassigned} without an owner · in projects that are still running
            </Typography>
          </Stack>
        </Panel>
        <Panel title="Budget spent by project" to="/budget" linkLabel="Budget" span={4}>
          <Stack spacing={2}>
            {budget.top.length === 0 && none('No running project has a budget yet.')}
            {budget.top.map((p) => (
              <div key={p.id}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                  <Link component={RouterLink} to={`/projects/${p.key}?tab=budget`} variant="body2" underline="hover" color="inherit" noWrap>
                    <b>{p.key}</b> {p.name}
                  </Link>
                  <Typography
                    variant="body2"
                    sx={{
                      color: "text.secondary",
                      whiteSpace: 'nowrap'
                    }}>
                    {formatMoney(p.spent, currency)} of {formatMoney(p.planned_budget, currency)}
                  </Typography>
                </Box>
                <UtilizationBar value={p.burn_pct} over={p.over_budget} unit="of budget spent" />
              </div>
            ))}
          </Stack>
        </Panel>
        <Panel title="Workload" to="/capacity" linkLabel="Capacity" span={4}>
          <Stack spacing={1.5}>
            {capacity.top.length === 0 && none('Nobody has assigned work in this period.')}
            {capacity.top.map((p) => (
              <Box key={p.user_id} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                <Avatar aria-hidden sx={{ width: 30, height: 30, fontSize: 12, fontWeight: 700, bgcolor: avatarColor(p.name), color: '#fff' }}>{initials(p.name)}</Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap><PersonLink id={p.user_id} name={p.name} /></Typography>
                  <UtilizationBar value={p.utilization_pct} over={p.over_allocated} />
                </Box>
              </Box>
            ))}
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>{formatDate(capacity.from)} – {formatDate(capacity.to)}</Typography>
          </Stack>
        </Panel>

        {user.role !== 'viewer' && (
          <Panel title="My work" to="/my-work" linkLabel="Open my work" span={12}>
            <Stack direction="row" spacing={4} useFlexGap sx={{
              flexWrap: "wrap"
            }}>
              <Typography><b>{mine.open}</b> open</Typography>
              <Typography color={mine.overdue ? 'error' : 'inherit'}><b>{mine.overdue}</b> overdue</Typography>
              <Typography><b>{mine.due_soon}</b> due in {work.due_soon_days} days</Typography>
            </Stack>
          </Panel>
        )}
      </Box>
    </>
  );
}

import { useCallback, useMemo, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditCalendarOutlinedIcon from '@mui/icons-material/EditCalendarOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { fetchCapacity, leavesApi, teamsApi, usersApi } from '../../api/resources';
import { useAuth } from '../../auth/AuthContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import FormDialog from '../../components/FormDialog';
import { useNotify } from '../../components/NotificationProvider';
import PageHeader from '../../components/PageHeader';
import StatusChip from '../../components/StatusChip';
import useApi from '../../hooks/useApi';
import { useMeta } from '../../meta/MetaContext';
import { formatDate } from '../../utils/format';
import leaveFields from '../leave/leaveFields';
import leaveLength from '../leave/leaveLength';
import UtilizationBar from '../capacity/UtilizationBar';
import PersonLink from '../../components/PersonLink';
import ToneChip from '../../components/ToneChip';

const today = () => new Date().toISOString().slice(0, 10);

/** One team: members with capacity and availability, and upcoming leave. Leads manage both. */
export default function TeamDetailPage() {
  const { id } = useParams();
  const notify = useNotify();
  const { user, can } = useAuth();
  const { meta } = useMeta();
  const [capacityFor, setCapacityFor] = useState(null);
  const [leaveDialog, setLeaveDialog] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const teamLoader = useCallback((signal) => teamsApi.get(id, signal), [id]);
  const membersLoader = useCallback((signal) => usersApi.list({ team_id: id, is_active: true, limit: 200, sort: 'name' }, signal), [id]);
  const capacityLoader = useCallback((signal) => fetchCapacity({ team_id: id }, signal), [id]);
  const leaveLoader = useCallback((signal) => leavesApi.list({ team_id: id, from: today(), sort: 'start_date', limit: 100 }, signal), [id]);
  const team = useApi(teamLoader);
  const members = useApi(membersLoader);
  const capacity = useApi(capacityLoader);
  const leaves = useApi(leaveLoader);

  const figures = useMemo(() => Object.fromEntries((capacity.data?.data || []).map((r) => [r.user_id, r])), [capacity.data]);
  const people = useMemo(() => (members.data?.data || []).map((m) => ({ value: m.id, label: m.name })), [members.data]);
  const refreshAll = () => { members.reload(); capacity.reload(); leaves.reload(); };

  if (team.error && !team.data) {
    return (
      <Alert severity={team.error.status === 404 ? 'warning' : 'error'} action={<Button component={RouterLink} to="/teams">All teams</Button>}>
        {team.error.status === 404 ? 'This team does not exist.' : team.error.message}
      </Alert>
    );
  }
  if (!team.data) return <LinearProgress aria-label="Loading team" />;
  const t = team.data;
  const manages = user.role === 'admin' || (user.role === 'team_lead' && t.lead_id === user.id);
  const window = capacity.data ? `${formatDate(capacity.data.from)} – ${formatDate(capacity.data.to)}` : '';

  return (
    <>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/teams" underline="hover">Teams</Link>
        <Typography sx={{
          color: "text.primary"
        }}>{t.name}</Typography>
      </Breadcrumbs>
      <PageHeader
        title={t.name}
        subtitle={`${t.department_name} · Lead: ${t.lead_name || 'none'}`}
        actions={manages && can('leaves', 'create') && (
          <Button variant="contained" startIcon={<EditCalendarOutlinedIcon />} onClick={() => setLeaveDialog({})}>Record leave</Button>
        )}
      />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h3" gutterBottom>Members{window && <Typography component="span" variant="body2" sx={{
            color: "text.secondary"
          }}> · availability {window}</Typography>}</Typography>
          {(members.loading || capacity.loading) && <LinearProgress aria-label="Loading members" sx={{ mb: 1 }} />}
          <TableContainer>
            <Table size="small" aria-label="Team members">
              <TableHead>
                <TableRow>
                  <TableCell>Person</TableCell><TableCell align="right">Hours / week</TableCell>
                  <TableCell align="right">Available (h)</TableCell><TableCell align="right">Allocated (h)</TableCell>
                  <TableCell sx={{ minWidth: 160 }}>Utilization</TableCell><TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {(members.data?.data || []).map((m) => {
                  const f = figures[m.id];
                  const editable = (m.permissions.editable_fields || []).includes('weekly_capacity_hours');
                  return (
                    <TableRow key={m.id} hover>
                      <TableCell>
                        <Typography><PersonLink id={m.id} name={m.name} /></Typography>
                        <Typography variant="body2" sx={{
                          color: "text.secondary"
                        }}>{m.job_title || m.role.replace('_', ' ')}</Typography>
                      </TableCell>
                      <TableCell align="right">{m.weekly_capacity_hours}</TableCell>
                      <TableCell align="right">{f ? f.available_hours : '—'}</TableCell>
                      <TableCell align="right">{f ? f.allocated_hours : '—'}</TableCell>
                      <TableCell>
                        {f && (
                          <Stack direction="row" spacing={1} sx={{
                            alignItems: "center"
                          }}>
                            <Box sx={{ flexGrow: 1 }}><UtilizationBar value={f.utilization_pct} over={f.over_allocated} /></Box>
                            {f.over_allocated && <ToneChip tone="error" label="Over" />}
                          </Stack>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {editable && (
                          <Tooltip title="Change weekly capacity">
                            <IconButton size="small" aria-label={`Change capacity of ${m.name}`} onClick={() => setCapacityFor(m)}><EditOutlinedIcon fontSize="small" /></IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {members.data && !members.data.data.length && (
                  <TableRow><TableCell colSpan={6}><Typography sx={{
                    color: "text.secondary"
                  }}>No members yet. Admins assign people to teams from the Users page.</Typography></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h3" gutterBottom>Upcoming leave</Typography>
          {leaves.data && !leaves.data.data.length && <Typography sx={{
            color: "text.secondary"
          }}>No upcoming leave.</Typography>}
          <Stack spacing={1} component="ul" sx={{ p: 0, m: 0, listStyle: 'none' }}>
            {(leaves.data?.data || []).map((leave) => (
              <Stack
                key={leave.id}
                component="li"
                direction="row"
                spacing={1.5}
                sx={{
                  alignItems: "center",
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  px: 1.5,
                  py: 0.75
                }}>
                <Typography
                  sx={{
                    fontWeight: 600,
                    minWidth: 130
                  }}>{leave.user_name}</Typography>
                <StatusChip value={leave.type} />
                <Typography sx={{ flexGrow: 1 }}>{formatDate(leave.start_date)} – {formatDate(leave.end_date)} · {leaveLength(leave)} day(s)</Typography>
                {leave.permissions.update && <IconButton size="small" aria-label={`Edit leave of ${leave.user_name}`} onClick={() => setLeaveDialog(leave)}><EditOutlinedIcon fontSize="small" /></IconButton>}
                {leave.permissions.delete && <IconButton size="small" aria-label={`Delete leave of ${leave.user_name}`} onClick={() => setDeleting(leave)}><DeleteOutlineIcon fontSize="small" /></IconButton>}
              </Stack>
            ))}
          </Stack>
        </CardContent>
      </Card>

      {capacityFor && (
        <FormDialog
          open
          title={`Weekly capacity of ${capacityFor.name}`}
          fields={[{ name: 'weekly_capacity_hours', label: 'Hours per week', type: 'number', required: true, min: 0, max: 168, step: 'any',
            helperText: 'Contracted hours. Planned leave is recorded separately.' }]}
          initialValues={capacityFor}
          editableFields={capacityFor.permissions.editable_fields}
          onSubmit={async (values) => { await usersApi.update(capacityFor.id, values); notify('Capacity updated'); refreshAll(); }}
          onClose={() => setCapacityFor(null)}
        />
      )}
      {leaveDialog && (
        <FormDialog
          open
          title={leaveDialog.id ? `Edit leave of ${leaveDialog.user_name}` : 'Record leave'}
          fields={leaveFields(meta, people)}
          initialValues={leaveDialog}
          editableFields={leaveDialog.id ? leaveDialog.permissions.editable_fields : null}
          submitLabel={leaveDialog.id ? 'Save' : 'Record'}
          onSubmit={async (values) => {
            if (leaveDialog.id) await leavesApi.update(leaveDialog.id, values); else await leavesApi.create(values);
            notify(leaveDialog.id ? 'Leave updated' : 'Leave recorded');
            refreshAll();
          }}
          onClose={() => setLeaveDialog(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          title="Delete leave?"
          message={`${deleting.user_name}: ${formatDate(deleting.start_date)} – ${formatDate(deleting.end_date)} will be removed.`}
          onConfirm={async () => { await leavesApi.remove(deleting.id); notify('Leave deleted'); refreshAll(); }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

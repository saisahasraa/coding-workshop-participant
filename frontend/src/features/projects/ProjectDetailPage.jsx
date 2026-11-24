import { useCallback, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { projectsApi } from '../../api/resources';
import { useAuth } from '../../auth/AuthContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import HealthChip from '../../components/HealthChip';
import FormDialog from '../../components/FormDialog';
import { useNotify } from '../../components/NotificationProvider';
import PageHeader from '../../components/PageHeader';
import ProgressCell from '../../components/ProgressCell';
import StatusChip from '../../components/StatusChip';
import useApi from '../../hooks/useApi';
import useLookups from '../../hooks/useLookups';
import { useMeta } from '../../meta/MetaContext';
import DeliverablesView from '../deliverables/DeliverablesView';
import UtilizationBar from '../capacity/UtilizationBar';
import BudgetTab from './BudgetTab';
import DependenciesTab from './DependenciesTab';
import TeamTab from './TeamTab';
import { HEALTH } from '../../utils/health';
import { formatDate, formatMoney, labelize } from '../../utils/format';
import projectFields from './projectFields';

function Fact({ label, children }) {
  return (
    <div>
      <Typography variant="body2" sx={{
        color: "text.secondary"
      }}>{label}</Typography>
      <Typography component="div">{children || '—'}</Typography>
    </div>
  );
}

Fact.propTypes = { label: PropTypes.string.isRequired, children: PropTypes.node };

function Overview({ project, currency }) {
  const visibility = project.visibility === 'inherit' ? 'Organization default' : labelize(project.visibility);
  return (
    <Grid container spacing={2}>
      {project.health && (
        <Grid size={12}>
          <Alert severity={HEALTH[project.health].severity}>
            <AlertTitle>{HEALTH[project.health].label}</AlertTitle>
            {project.health_reasons.length === 0
              ? 'Schedule, budget and deliverables are all within their limits.'
              : <Stack component="ul" sx={{ m: 0, pl: 2 }}>{project.health_reasons.map((r) => <li key={r.code}>{r.message}</li>)}</Stack>}
          </Alert>
        </Grid>
      )}
      <Grid size={{ xs: 12, md: 4 }}>
        <Card sx={{ height: '100%' }}><CardContent>
          <Typography variant="h3" gutterBottom>Progress</Typography>
          <ProgressCell value={project.progress_pct} />
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mt: 1
            }}>
            {project.deliverables_completed} of {project.deliverables_total} deliverables completed
          </Typography>
        </CardContent></Card>
      </Grid>
      <Grid size={{ xs: 12, sm: 6, md: 4 }}>
        <Card sx={{ height: '100%' }}><CardContent>
          <Typography variant="h3" gutterBottom>Delivery</Typography>
          <Stack direction="row" spacing={3}>
            <Fact label="Overdue"><Typography color={project.deliverables_overdue ? 'error' : 'inherit'} sx={{
              fontWeight: 600
            }}>{project.deliverables_overdue}</Typography></Fact>
            <Fact label="Blocked"><Typography color={project.deliverables_blocked ? 'error' : 'inherit'} sx={{
              fontWeight: 600
            }}>{project.deliverables_blocked}</Typography></Fact>
          </Stack>
        </CardContent></Card>
      </Grid>
      <Grid size={{ xs: 12, sm: 6, md: 4 }}>
        <Card sx={{ height: '100%' }}><CardContent>
          <Typography variant="h3" gutterBottom>Budget</Typography>
          <Stack direction="row" spacing={3} sx={{ mb: 1 }}>
            <Fact label="Planned">{formatMoney(project.planned_budget, currency)}</Fact>
            <Fact label="Spent">{formatMoney(Number(project.budget_spent), currency)}</Fact>
          </Stack>
          <UtilizationBar value={project.budget_burn_pct} over={project.budget_burn_pct > 100} unit="of budget spent" />
        </CardContent></Card>
      </Grid>
      <Grid size={12}>
        <Card><CardContent>
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, md: 3 }}><Fact label="Manager">{project.manager_name}</Fact></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Fact label="Department">{project.department_name}</Fact></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Fact label="Start">{formatDate(project.start_date)}</Fact></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Fact label="Target end">{formatDate(project.end_date)}</Fact></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Fact label="Visibility">{visibility}</Fact></Grid>
            {project.completed_at && <Grid size={{ xs: 6, md: 3 }}><Fact label="Completed">{formatDate(project.completed_at)}</Fact></Grid>}
            <Grid size={12}><Fact label="Description"><Typography sx={{ whiteSpace: 'pre-wrap' }}>{project.description}</Typography></Fact></Grid>
          </Grid>
        </CardContent></Card>
      </Grid>
    </Grid>
  );
}

Overview.propTypes = { project: PropTypes.object.isRequired, currency: PropTypes.string.isRequired };

/** One project: overview and deliverables, with edit/delete for those allowed. */
export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const { can, user } = useAuth();
  const { meta, currency } = useMeta();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const lookups = useLookups(['departments', 'managers'], editing);

  const loader = useCallback((signal) => projectsApi.get(id, signal), [id]);
  const { data: project, error, loading, reload } = useApi(loader);
  const projectId = project?.id;
  const deliverableQuery = useMemo(() => ({ project_id: projectId }), [projectId]);

  if (error && !project) {
    return (
      <Alert severity={error.status === 404 ? 'warning' : 'error'} action={<Button component={RouterLink} to="/projects">All projects</Button>}>
        {error.status === 404 ? 'This project does not exist or is not visible to you.' : error.message}
      </Alert>
    );
  }
  if (!project) return <LinearProgress aria-label="Loading project" />;

  const canAddDeliverables = can('deliverables', 'create') && project.permissions.update;

  return (
    <>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/projects" underline="hover">Projects</Link>
        <Typography sx={{
          color: "text.primary"
        }}>{project.key}</Typography>
      </Breadcrumbs>
      <PageHeader
        title={`${project.key} · ${project.name}`}
        subtitle={<Stack direction="row" spacing={1} component="span" sx={{ mt: 0.5 }}><StatusChip value={project.status} /><StatusChip value={project.priority} /><HealthChip level={project.health} reasons={project.health_reasons} /></Stack>}
        actions={(
          <>
            {project.permissions.update && <Button startIcon={<EditOutlinedIcon />} variant="outlined" onClick={() => setEditing(true)}>Edit</Button>}
            {project.permissions.delete && <Button startIcon={<DeleteOutlineIcon />} color="error" onClick={() => setDeleting(true)}>Delete</Button>}
          </>
        )}
      />
      {loading && <LinearProgress aria-label="Refreshing" sx={{ mb: 1 }} />}
      <Tabs value={tab} onChange={(_e, value) => setParams(value === 'overview' ? {} : { tab: value }, { replace: true })} sx={{ mb: 2 }}>
        <Tab value="overview" label="Overview" />
        <Tab value="deliverables" label={`Deliverables (${project.deliverables_total})`} />
        <Tab value="team" label="Team" />
        <Tab value="budget" label="Budget" />
        <Tab value="dependencies" label="Dependencies" />
      </Tabs>
      {tab === 'overview' && <Overview project={project} currency={currency} />}
      {tab === 'team' && <TeamTab project={project} />}
      {tab === 'budget' && <BudgetTab project={project} onChange={reload} />}
      {tab === 'dependencies' && <DependenciesTab project={project} />}
      {tab === 'deliverables' && (
        <DeliverablesView
          baseQuery={deliverableQuery}
          projectId={project.id}
          projectDates={{ start: project.start_date, end: project.end_date }}
          canCreate={canAddDeliverables}
          onChange={reload}
        />
      )}
      {editing && (
        <FormDialog
          open
          title={`Edit ${project.key}`}
          fields={projectFields(meta, lookups, user.role === 'admin')}
          initialValues={project}
          editableFields={project.permissions.editable_fields}
          onSubmit={async (values) => { await projectsApi.update(project.id, values); notify('Project updated'); reload(); }}
          onClose={() => setEditing(false)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          title={`Delete ${project.key}?`}
          message={`This permanently deletes the project and its ${project.deliverables_total} deliverable(s).`}
          onConfirm={async () => { await projectsApi.remove(project.id); notify(`Project ${project.key} deleted`); navigate('/projects'); }}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  );
}

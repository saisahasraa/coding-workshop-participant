import { useCallback, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { deliverablesApi } from '../../api/resources';
import { useAuth } from '../../auth/AuthContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useNotify } from '../../components/NotificationProvider';
import StatusChip from '../../components/StatusChip';
import useApi from '../../hooks/useApi';
import useLookups from '../../hooks/useLookups';
import { useMeta } from '../../meta/MetaContext';
import { formatDate } from '../../utils/format';
import CommentsSection from './CommentsSection';
import DetailsPanel from './DetailsPanel';
import InlineText from './InlineText';
import LinksSection from './LinksSection';

/** One deliverable, Jira-style: content on the left, metadata on the right. */
export default function DeliverableDetailPage() {
  const { id: ref } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const { user } = useAuth();
  const { meta } = useMeta();
  const [deleting, setDeleting] = useState(false);
  const [completing, setCompleting] = useState(false);

  const loader = useCallback((signal) => deliverablesApi.get(ref, signal), [ref]);
  const { data: item, error, loading, reload, setData } = useApi(loader);

  const canEditAny = Boolean(item?.permissions.update);
  const people = useLookups(['people'], canEditAny).people || [];

  if (error && !item) {
    return (
      <Alert severity={error.status === 404 ? 'warning' : 'error'} action={<Button component={RouterLink} to="/deliverables">All deliverables</Button>}>
        {error.status === 404 ? 'This deliverable does not exist or is not visible to you.' : error.message}
      </Alert>
    );
  }
  if (!item) return <LinearProgress aria-label="Loading deliverable" />;

  const { permissions } = item;
  const allowed = permissions.editable_fields;
  const canEdit = (name) => permissions.update && (allowed === null || allowed.includes(name));
  const managesProject = user.role === 'admin' || (user.role === 'project_manager' && item.project_manager_id === user.id);

  /** Save changed fields and refresh the page data in place. Rejects so inputs can show the error. */
  const save = async (changes) => {
    const updated = await deliverablesApi.update(item.id, changes);
    setData(updated);
    if (updated.key !== item.key) navigate(`/deliverables/${updated.key}`, { replace: true });
  };

  const markComplete = async () => {
    setCompleting(true);
    try {
      await save({ status: 'completed' });
      notify('Marked as completed');
    } catch (err) {
      notify(err.details?.status || err.message, 'error');
    } finally {
      setCompleting(false);
    }
  };

  return (
    <>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/projects" underline="hover">Projects</Link>
        <Link component={RouterLink} to={`/projects/${item.project_key}?tab=deliverables`} underline="hover">{item.project_key}</Link>
        <Typography color="text.primary">{item.key}</Typography>
      </Breadcrumbs>
      {loading && <LinearProgress aria-label="Refreshing" sx={{ mb: 1 }} />}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Stack spacing={3}>
            <div>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <Chip size="small" label={item.key} variant="outlined" />
                <StatusChip value={item.status} />
                <StatusChip value={item.priority} />
              </Stack>
              <InlineText label="Title" value={item.name} editable={canEdit('name')} multiline={false} variant="h1"
                placeholder="Untitled" onSave={(name) => save({ name: name || item.name })} />
            </div>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {canEdit('status') && item.status !== 'completed' && (
                <Button variant="contained" color="success" startIcon={<CheckCircleOutlineIcon />} onClick={markComplete} disabled={completing}>
                  Mark complete
                </Button>
              )}
              {permissions.delete && (
                <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={() => setDeleting(true)}>Delete</Button>
              )}
            </Stack>

            {item.is_overdue && <Alert severity="error">Overdue: this was due on {formatDate(item.due_date)}.</Alert>}
            {item.status === 'blocked' && <Alert severity="warning">Blocked: this deliverable cannot progress until the blocker is resolved.</Alert>}

            <section aria-labelledby="description-heading">
              <Typography id="description-heading" variant="h3" gutterBottom>Description</Typography>
              <InlineText label="Description" value={item.description} editable={canEdit('description')}
                placeholder={canEdit('description') ? 'Add a description…' : 'No description yet.'}
                onSave={(description) => save({ description })} />
            </section>

            <section aria-labelledby="criteria-heading">
              <Typography id="criteria-heading" variant="h3" gutterBottom>Acceptance criteria</Typography>
              <InlineText label="Acceptance criteria" value={item.acceptance_criteria} editable={canEdit('acceptance_criteria')}
                placeholder={canEdit('acceptance_criteria') ? 'Add acceptance criteria…' : 'None defined.'}
                onSave={(acceptance_criteria) => save({ acceptance_criteria })} />
            </section>

            <Divider />
            <LinksSection deliverableKey={item.key} canEdit={managesProject} onChanged={reload} />
            <Divider />
            <CommentsSection deliverableKey={item.key} canComment={user.role !== 'viewer'} />
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <DetailsPanel item={item} meta={meta} people={people} onSave={save} />
        </Grid>
      </Grid>

      {deleting && (
        <ConfirmDialog
          open
          title={`Delete ${item.key}?`}
          message={`"${item.name}" and its comments and links will be permanently removed.`}
          onConfirm={async () => {
            await deliverablesApi.remove(item.id);
            notify(`${item.key} deleted`);
            navigate(`/projects/${item.project_key}?tab=deliverables`);
          }}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  );
}

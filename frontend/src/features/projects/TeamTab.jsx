import { useCallback } from 'react';
import PropTypes from 'prop-types';
import { Link as RouterLink } from 'react-router-dom';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PersonOffOutlinedIcon from '@mui/icons-material/PersonOffOutlined';
import { fetchProjectTeam } from '../../api/resources';
import ProgressCell from '../../components/ProgressCell';
import StatusChip from '../../components/StatusChip';
import useApi from '../../hooks/useApi';
import { formatDate, labelize } from '../../utils/format';
import ToneChip from '../../components/ToneChip';
import { avatarColor, initials } from '../../utils/people';


function DeliverableRow({ item }) {
  return (
    <Stack
      component="li"
      direction={{ xs: 'column', md: 'row' }}
      spacing={{ xs: 0.5, md: 2 }}
      sx={{
        alignItems: { md: 'center' },
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        px: 1.5,
        py: 1
      }}>
      <Link
        component={RouterLink}
        to={`/deliverables/${item.key}`}
        underline="hover"
        sx={{
          fontWeight: 600,
          minWidth: 84
        }}>{item.key}</Link>
      <Typography sx={{ flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{item.name}</Typography>
      <StatusChip value={item.status} />
      <Typography
        variant="body2"
        color={item.is_overdue ? 'error' : 'text.secondary'}
        sx={{
          fontWeight: item.is_overdue ? 600 : 400,
          minWidth: 120
        }}>
        {item.due_date ? `${item.is_overdue ? 'Overdue · ' : 'Due '}${formatDate(item.due_date)}` : 'No due date'}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: "text.secondary",
          minWidth: 70
        }}>
        {item.estimated_hours != null ? `${item.estimated_hours} h` : 'No estimate'}
      </Typography>
      <Box sx={{ minWidth: 130 }}><ProgressCell value={item.progress_pct} /></Box>
    </Stack>
  );
}

DeliverableRow.propTypes = { item: PropTypes.object.isRequired };

function Person({ person }) {
  const unassigned = person.user_id === null;
  return (
    <Accordion disableGutters variant="outlined" slotProps={{ transition: { unmountOnExit: true } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-label={`${person.name}, ${person.deliverables_total} deliverable${person.deliverables_total === 1 ? '' : 's'}`}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={{ xs: 0.5, md: 2 }}
          sx={{
            alignItems: { md: 'center' },
            width: '100%',
            pr: 1
          }}>
          <Stack
            direction="row"
            spacing={1.5}
            sx={{
              alignItems: "center",
              minWidth: { md: 260 },
              flexGrow: 1
            }}>
            <Avatar aria-hidden sx={{ width: 34, height: 34, fontSize: 14, fontWeight: 700, bgcolor: unassigned ? 'action.disabledBackground' : avatarColor(person.name), color: unassigned ? 'text.secondary' : '#fff' }}>
              {unassigned ? <PersonOffOutlinedIcon fontSize="small" /> : initials(person.name)}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{
                fontWeight: 600
              }}>{person.name}</Typography>
              {!unassigned && <Typography variant="body2" noWrap sx={{
                color: "text.secondary"
              }}>{person.job_title || labelize(person.role)}</Typography>}
            </Box>
          </Stack>
          <Stack direction="row" spacing={0.75} useFlexGap sx={{
            flexWrap: "wrap"
          }}>
            <Chip size="small" variant="outlined" label={`${person.deliverables_total} deliverable${person.deliverables_total === 1 ? '' : 's'}`} />
            <Chip size="small" variant="outlined" label={`${person.deliverables_open} open`} />
            <Chip size="small" variant="outlined" label={`${person.remaining_hours} h remaining of ${person.estimated_hours} h`} />
            {person.overdue > 0 && <ToneChip tone="error" label={`${person.overdue} overdue`} />}
          </Stack>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack component="ul" spacing={1} sx={{ p: 0, m: 0, listStyle: 'none' }}>
          {person.deliverables.map((item) => <DeliverableRow key={item.id} item={item} />)}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

Person.propTypes = { person: PropTypes.object.isRequired };

/** Everyone working on a project's deliverables; open a person to see their deliverables in this project. */
export default function TeamTab({ project }) {
  const loader = useCallback((signal) => fetchProjectTeam(project.key, signal), [project.key]);
  const { data, error, loading } = useApi(loader);

  if (error && !data) return <Alert severity="error">{error.message}</Alert>;
  return (
    <>
      <Typography
        sx={{
          color: "text.secondary",
          mb: 2
        }}>
        People who own deliverables in {project.key}. Each deliverable's remaining hours are reserved on its owner's capacity until its due date.
      </Typography>
      {loading && <LinearProgress aria-label="Loading team" sx={{ mb: 1 }} />}
      {data && !data.data.length && <Typography sx={{
        color: "text.secondary"
      }}>No deliverables yet, so nobody is working on this project.</Typography>}
      {data?.truncated && <Alert severity="info" sx={{ mb: 2 }}>Showing the first part of a very large project.</Alert>}
      <Stack spacing={1}>
        {(data?.data || []).map((person) => <Person key={person.user_id ?? 'unassigned'} person={person} />)}
      </Stack>
    </>
  );
}

TeamTab.propTypes = {
  project: PropTypes.shape({ key: PropTypes.string.isRequired }).isRequired,
};

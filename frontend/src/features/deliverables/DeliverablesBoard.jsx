import PropTypes from 'prop-types';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import DueDate from '../../components/DueDate';
import Person from '../../components/Person';
import StatusChip from '../../components/StatusChip';
import { labelize } from '../../utils/format';
import StatusMenu from './StatusMenu';

/** Deliverables as one column per status. Move a card by changing its status on the card. */
export default function DeliverablesBoard({ rows, statuses, showProject = false, onChanged }) {
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: `repeat(${statuses.length}, minmax(0, 1fr))` }, alignItems: 'start' }}>
      {statuses.map((status) => {
        const items = rows.filter((row) => row.status === status);
        return (
          <Box key={status} component="section" aria-label={`${labelize(status)} (${items.length})`}
            sx={{ bgcolor: 'action.hover', borderRadius: 3, p: 1.5, minHeight: 120 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5, px: 0.5 }}>
              <StatusChip value={status} />
              <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>{items.length}</Typography>
            </Stack>
            <Stack component="ul" spacing={1} sx={{ p: 0, m: 0, listStyle: 'none' }}>
              {items.map((row) => (
                <Card key={row.id} component="li" sx={{ p: 1.5, borderRadius: 2.5 }}>
                  <Stack spacing={1}>
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                      <Link component={RouterLink} to={`/deliverables/${row.key}`} underline="hover" sx={{ fontWeight: 700 }}>{row.key}</Link>{' '}{row.name}
                    </Typography>
                    {showProject && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{row.project_name}</Typography>}
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 1 }}>
                      <Person name={row.owner_name} size={22} />
                      <StatusChip value={row.priority} />
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                      <DueDate date={row.due_date} done={row.status === 'completed'} />
                      <StatusMenu item={row} onChanged={onChanged} />
                    </Stack>
                  </Stack>
                </Card>
              ))}
              {!items.length && <Typography component="li" variant="body2" sx={{ color: 'text.secondary', px: 0.5 }}>Nothing here.</Typography>}
            </Stack>
          </Box>
        );
      })}
    </Box>
  );
}

DeliverablesBoard.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.object).isRequired,
  /** Status values, in column order. */
  statuses: PropTypes.arrayOf(PropTypes.string).isRequired,
  showProject: PropTypes.bool,
  /** Called after a card's status changed. */
  onChanged: PropTypes.func,
};

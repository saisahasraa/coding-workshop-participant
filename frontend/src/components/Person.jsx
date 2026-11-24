import PropTypes from 'prop-types';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { avatarColor, initials } from '../utils/people';

/** A person as a small avatar and their name; `Unassigned` when there is nobody. */
export default function Person({ name, empty = 'Unassigned', size = 24 }) {
  if (!name) return <Typography variant="body2" component="span" sx={{ color: 'text.secondary' }}>{empty}</Typography>;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Avatar aria-hidden sx={{ width: size, height: size, fontSize: size * 0.42, fontWeight: 700, bgcolor: avatarColor(name), color: '#fff' }}>{initials(name)}</Avatar>
      <Typography variant="body2" component="span" noWrap>{name}</Typography>
    </Box>
  );
}

Person.propTypes = {
  name: PropTypes.string,
  /** Text shown when there is no person. */
  empty: PropTypes.string,
  size: PropTypes.number,
};

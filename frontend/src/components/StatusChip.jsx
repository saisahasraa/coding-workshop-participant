import PropTypes from 'prop-types';
import Chip from '@mui/material/Chip';
import { labelize } from '../utils/format';

const COLORS = {
  // project statuses
  planning: 'default', active: 'primary', on_hold: 'warning', completed: 'success', cancelled: 'default',
  // deliverable statuses
  not_started: 'default', in_progress: 'primary', blocked: 'error',
  // priorities
  low: 'default', medium: 'info', high: 'warning', critical: 'error',
  // roles
  admin: 'secondary', project_manager: 'primary', team_lead: 'info', team_member: 'default', viewer: 'default',
};

/** Colored chip for statuses, priorities and roles. */
export default function StatusChip({ value, size = 'small' }) {
  if (!value) return null;
  const color = COLORS[value] || 'default';
  return <Chip size={size} label={labelize(value)} color={color} variant={color === 'default' ? 'outlined' : 'filled'} />;
}

StatusChip.propTypes = {
  /** Enum value, e.g. `in_progress`. */
  value: PropTypes.string,
  size: PropTypes.oneOf(['small', 'medium']),
};

import PropTypes from 'prop-types';
import Chip from '@mui/material/Chip';
import { labelize } from '../utils/format';
import { STATUS_COLORS } from '../utils/statusColors';
import { tonal } from '../utils/tonal';

/** Soft coloured chip for statuses, priorities and roles. */
export default function StatusChip({ value, size = 'small', ...rest }) {
  if (!value) return null;
  return <Chip size={size} label={labelize(value)} sx={tonal(STATUS_COLORS[value] || 'default')} {...rest} />;
}

StatusChip.propTypes = {
  /** Enum value, e.g. `in_progress`. */
  value: PropTypes.string,
  size: PropTypes.oneOf(['small', 'medium']),
};

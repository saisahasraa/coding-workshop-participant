import PropTypes from 'prop-types';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { HEALTH } from '../utils/health';
import { tonal } from '../utils/tonal';

/** Project health as a chip; hovering it explains why. Renders nothing for projects that are not judged. */
export default function HealthChip({ level, reasons = [], size = 'small' }) {
  const health = HEALTH[level];
  if (!health) return null;
  const chip = <Chip size={size} label={health.label} sx={tonal(health.color)} />;
  if (!reasons.length) return chip;
  return <Tooltip describeChild title={reasons.map((r) => r.message).join('. ')}>{chip}</Tooltip>;
}

HealthChip.propTypes = {
  /** `green`, `amber`, `red`, or empty when the project has no health. */
  level: PropTypes.string,
  reasons: PropTypes.arrayOf(PropTypes.shape({ message: PropTypes.string.isRequired })),
  size: PropTypes.oneOf(['small', 'medium']),
};

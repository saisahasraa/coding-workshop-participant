import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import { Link as RouterLink } from 'react-router-dom';
import Typography from '@mui/material/Typography';

/** One row of a ranked bar list: a label, a bar scaled to `max`, and the figure. Bars share a baseline. */
export default function BarRow({ label, value, max, valueLabel, color = 'primary', to }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const name = to
    ? <Link component={RouterLink} to={to} underline="hover" color="inherit" variant="body2">{label}</Link>
    : <Typography variant="body2">{label}</Typography>;
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
        {name}
        <Typography variant="body2" sx={{
          fontWeight: 600
        }}>{valueLabel ?? value}</Typography>
      </Box>
      <LinearProgress variant="determinate" value={pct} color={color} aria-label={`${label}: ${valueLabel ?? value}`}
        sx={{ height: 8, borderRadius: 4, mt: 0.5 }} />
    </Box>
  );
}

BarRow.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.number.isRequired,
  /** The value that fills the bar. */
  max: PropTypes.number.isRequired,
  /** Text for the figure when it is not the bare value (e.g. `3 of 5`). */
  valueLabel: PropTypes.string,
  color: PropTypes.oneOf(['primary', 'success', 'warning', 'error', 'inherit']),
  to: PropTypes.string,
};

import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';

/** Utilization as a bar and percentage; red when over-allocated, grey when there is no availability. */
export default function UtilizationBar({ value, over }) {
  if (value === null || value === undefined) {
    return <Typography variant="body2" color="text.secondary">{over ? 'No availability' : '—'}</Typography>;
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <LinearProgress variant="determinate" value={Math.min(value, 100)} color={over ? 'error' : value >= 85 ? 'warning' : 'primary'}
        sx={{ flexGrow: 1, height: 6, borderRadius: 3 }} aria-label={`${value}% utilized`} />
      <Typography variant="body2" sx={{ minWidth: 48, textAlign: 'right', fontWeight: over ? 700 : 400 }} color={over ? 'error' : 'inherit'}>{value}%</Typography>
    </Box>
  );
}

UtilizationBar.propTypes = {
  /** Percentage of availability committed; `null` when the person has no availability. */
  value: PropTypes.number,
  over: PropTypes.bool,
};

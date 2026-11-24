import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';

/** Compact progress bar with percentage label. */
export default function ProgressCell({ value }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', minWidth: 90 }}>
      <LinearProgress variant="determinate" value={pct} sx={{ flexGrow: 1, height: 6, borderRadius: 3 }}
        color={pct === 100 ? 'success' : 'primary'} aria-label={`${pct}% complete`} />
      <Typography variant="body2" sx={{ minWidth: 36, textAlign: 'right' }}>{pct}%</Typography>
    </Box>
  );
}

ProgressCell.propTypes = {
  value: PropTypes.number,
};

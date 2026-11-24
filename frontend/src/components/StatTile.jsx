import PropTypes from 'prop-types';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Typography from '@mui/material/Typography';
import { tonal } from '../utils/tonal';

/** A labelled figure, optionally with an icon and a link to the list behind the number. */
export default function StatTile({ label, value, tone, hint, icon, to }) {
  const body = (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', p: 2, height: '100%' }}>
      {icon && (
        <Box aria-hidden sx={[{ width: 40, height: 40, borderRadius: 2.5, display: 'grid', placeItems: 'center', flexShrink: 0 }, tonal(tone || 'primary')]}>
          {icon}
        </Box>
      )}
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            fontWeight: 500
          }}>{label}</Typography>
        <Typography variant="h2" component="p" color={tone ? `${tone}.main` : 'text.primary'} sx={{ lineHeight: 1.25, fontSize: '1.625rem' }}>{value}</Typography>
        {hint && <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>{hint}</Typography>}
      </Box>
    </Box>
  );
  return (
    <Card sx={{ height: '100%' }}>
      {to ? <CardActionArea component={RouterLink} to={to} sx={{ height: '100%' }}>{body}</CardActionArea> : body}
    </Card>
  );
}

StatTile.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  /** Theme colour for the figure and icon (e.g. `error` when the number is bad news). */
  tone: PropTypes.string,
  hint: PropTypes.string,
  icon: PropTypes.node,
  /** Where the tile leads. */
  to: PropTypes.string,
};

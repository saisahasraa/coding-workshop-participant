import PropTypes from 'prop-types';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

/** A labelled figure. */
export default function StatTile({ label, value, tone, hint }) {
  return (
    <Card sx={{ height: '100%' }}><CardContent>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="h2" component="p" color={tone}>{value}</Typography>
      {hint && <Typography variant="body2" color="text.secondary">{hint}</Typography>}
    </CardContent></Card>
  );
}

StatTile.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  tone: PropTypes.string,
  hint: PropTypes.string,
};

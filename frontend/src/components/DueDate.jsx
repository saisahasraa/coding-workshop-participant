import PropTypes from 'prop-types';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { dueInWords } from '../utils/due';
import { formatDate } from '../utils/format';
import { toneText } from '../utils/tonal';

/** A due date said in words when it is near or missed ("3 days overdue"), with the date on hover. */
export default function DueDate({ date, done = false }) {
  if (!date) return <Typography variant="body2" component="span" sx={{ color: 'text.secondary' }}>No due date</Typography>;
  const words = dueInWords(date, done);
  if (!words) return <Typography variant="body2" component="span">{formatDate(date)}</Typography>;
  return (
    <Tooltip title={formatDate(date)}>
      <Typography variant="body2" component="span" sx={words.tone ? [toneText(words.tone), { fontWeight: 600 }] : undefined}>
        {words.text}
      </Typography>
    </Tooltip>
  );
}

DueDate.propTypes = {
  /** ISO date (`YYYY-MM-DD`). */
  date: PropTypes.string,
  /** Completed work shows its plain date. */
  done: PropTypes.bool,
};

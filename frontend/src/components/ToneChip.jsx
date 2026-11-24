import PropTypes from 'prop-types';
import Chip from '@mui/material/Chip';
import { tonal } from '../utils/tonal';

/** A small soft-coloured chip: a tint of `tone` behind text in its strong shade. */
export default function ToneChip({ tone = 'default', ...rest }) {
  return <Chip size="small" sx={tonal(tone)} {...rest} />;
}

ToneChip.propTypes = {
  /** Theme colour: primary, secondary, success, warning, error, info or default. */
  tone: PropTypes.string,
};

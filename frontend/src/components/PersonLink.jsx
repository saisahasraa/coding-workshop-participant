import PropTypes from 'prop-types';
import { Link as RouterLink } from 'react-router-dom';
import Link from '@mui/material/Link';

/** A person's name as a link to all of their deliverables. */
export default function PersonLink({ id, name, ...rest }) {
  return (
    <Link component={RouterLink} to={`/deliverables?person=${id}`} underline="hover" color="primary" aria-label={`${name}: all deliverables`}
      sx={{ fontWeight: 600 }} {...rest}>
      {name}
    </Link>
  );
}

PersonLink.propTypes = { id: PropTypes.number.isRequired, name: PropTypes.string.isRequired };

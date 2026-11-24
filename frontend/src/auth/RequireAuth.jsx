import PropTypes from 'prop-types';
import { Navigate, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useAuth } from './AuthContext';

/**
 * Renders children for signed-in users; otherwise redirects to /login and comes back afterwards.
 * With `resource`, also requires the role to have `action` on it (else shows "no access").
 */
export default function RequireAuth({ children, resource, action = 'read' }) {
  const { status, can } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
        <CircularProgress aria-label="Restoring session" />
      </Box>
    );
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (resource && !can(resource, action)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

RequireAuth.propTypes = {
  children: PropTypes.node,
  /** Resource name from the permissions map, e.g. `users`. */
  resource: PropTypes.string,
  /** Required action on `resource`. */
  action: PropTypes.string,
};

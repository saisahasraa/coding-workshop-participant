import { Component } from 'react';
import PropTypes from 'prop-types';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';

/**
 * Catches rendering errors below it and shows a recoverable message instead of a blank page.
 * Give it a `key` (e.g. the route path) to reset it on navigation.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI error', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    const { children } = this.props;
    if (!error) return children;
    return (
      <Alert
        severity="error"
        action={<Button color="inherit" onClick={() => this.setState({ error: null })}>Try again</Button>}
      >
        <AlertTitle>Something went wrong</AlertTitle>
        This part of the page failed to load. Try again, or reload the page.
      </Alert>
    );
  }
}

ErrorBoundary.propTypes = {
  /** Content to protect. */
  children: PropTypes.node,
};

export default ErrorBoundary;

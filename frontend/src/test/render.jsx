/* eslint-disable react-refresh/only-export-components */
/** Render helper wrapping components in the app's providers. */
import PropTypes from 'prop-types';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Context as ResponsiveContext } from 'react-responsive';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../theme';

function Providers({ children, route, width }) {
  return (
    <ResponsiveContext.Provider value={{ width }}>
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </ThemeProvider>
    </ResponsiveContext.Provider>
  );
}

Providers.propTypes = {
  children: PropTypes.node,
  route: PropTypes.string.isRequired,
  width: PropTypes.number.isRequired,
};

/**
 * Render `ui` at `route` with a simulated viewport `width` (px).
 * @param {import('react').ReactElement} ui
 * @param {{route?: string, width?: number}} [options]
 */
export function renderWithProviders(ui, { route = '/', width = 1280 } = {}) {
  return render(<Providers route={route} width={width}>{ui}</Providers>);
}

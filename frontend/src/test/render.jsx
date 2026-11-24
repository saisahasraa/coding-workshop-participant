/* eslint-disable react-refresh/only-export-components */
/** Render helper wrapping components in the app's providers. */
import PropTypes from 'prop-types';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Context as ResponsiveContext } from 'react-responsive';
import { ThemeProvider } from '@mui/material/styles';
import AuthProvider from '../auth/AuthProvider';
import RequireAuth from '../auth/RequireAuth';
import { setTokens } from '../auth/tokenStore';
import NotificationProvider from '../components/NotificationProvider';
import MetaProvider from '../meta/MetaProvider';
import theme from '../theme';

function Providers({ children, route, width }) {
  return (
    <ResponsiveContext.Provider value={{ width }}>
      <ThemeProvider theme={theme} defaultMode="light">
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

/**
 * Render `ui` inside the real auth/meta/notification providers. With `signedIn`, a refresh token
 * is stored so the session resumes (pair with `sessionHandlers(role)`), and `ui` renders once
 * signed in, as behind the app's RequireAuth.
 * @param {import('react').ReactElement} ui
 * Pass `guard: false` for `<App />`, which has its own guards.
 * @param {{route?: string, width?: number, signedIn?: boolean, guard?: boolean, keepStorage?: boolean}} [options]
 */
export function renderWithApp(ui, {
  route = '/', width = 1280, signedIn = true, guard = signedIn, keepStorage = false,
} = {}) {
  if (!keepStorage) window.localStorage.clear();
  if (signedIn) setTokens({ access_token: 'stale', refresh_token: 'refresh-1' });
  return render(
    <Providers route={route} width={width}>
      <AuthProvider><MetaProvider><NotificationProvider>
        {guard ? <RequireAuth>{ui}</RequireAuth> : ui}
      </NotificationProvider></MetaProvider></AuthProvider>
    </Providers>,
  );
}

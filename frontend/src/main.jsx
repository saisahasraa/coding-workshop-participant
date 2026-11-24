import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import '@fontsource-variable/inter';
import App from './App';
import AuthProvider from './auth/AuthProvider';
import NotificationProvider from './components/NotificationProvider';
import MetaProvider from './meta/MetaProvider';
import ErrorBoundary from './components/ErrorBoundary';
import { COLOR_MODE_KEY } from './config';
import theme from './theme';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider theme={theme} defaultMode="system" modeStorageKey={COLOR_MODE_KEY}>
      <CssBaseline />
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <MetaProvider>
              <NotificationProvider>
                <App />
              </NotificationProvider>
            </MetaProvider>
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
);

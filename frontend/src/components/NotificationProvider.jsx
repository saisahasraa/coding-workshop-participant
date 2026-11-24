/* eslint-disable react-refresh/only-export-components */
import {
  createContext, useCallback, useContext, useMemo, useState,
} from 'react';
import PropTypes from 'prop-types';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';

const NotifyContext = createContext(() => {});

/**
 * `notify(message, severity?)` shows a short toast. Severity: success | info | warning | error.
 * @returns {(message: string, severity?: string) => void}
 */
export const useNotify = () => useContext(NotifyContext);

/** Snackbar notifications for success and failure feedback. */
export default function NotificationProvider({ children }) {
  const [toast, setToast] = useState(null);
  const notify = useCallback((message, severity = 'success') => {
    setToast({ message, severity, key: Date.now() });
  }, []);
  const value = useMemo(() => notify, [notify]);

  return (
    <NotifyContext.Provider value={value}>
      {children}
      <Snackbar
        key={toast?.key}
        open={Boolean(toast)}
        autoHideDuration={toast?.severity === 'error' ? 8000 : 4000}
        onClose={(_e, reason) => reason !== 'clickaway' && setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)} sx={{ width: '100%' }}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </NotifyContext.Provider>
  );
}

NotificationProvider.propTypes = {
  children: PropTypes.node,
};

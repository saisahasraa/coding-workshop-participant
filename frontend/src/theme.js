import { createTheme } from '@mui/material/styles';

/** Application theme: one place for palette, typography, shape and component defaults. */
const theme = createTheme({
  palette: {
    primary: { main: '#1f5fbf' },
    secondary: { main: '#6b4fbb' },
    success: { main: '#2e7d32' },
    warning: { main: '#ed6c02' },
    error: { main: '#d32f2f' },
    background: { default: '#f5f7fb', paper: '#ffffff' },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'Roboto, system-ui, -apple-system, "Segoe UI", sans-serif',
    h1: { fontSize: '1.75rem', fontWeight: 600 },
    h2: { fontSize: '1.375rem', fontWeight: 600 },
    h3: { fontSize: '1.125rem', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 500 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiCard: { defaultProps: { variant: 'outlined' } },
    MuiAppBar: { defaultProps: { elevation: 0, color: 'inherit' } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
  },
});

export default theme;

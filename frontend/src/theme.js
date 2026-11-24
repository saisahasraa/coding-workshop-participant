import { createTheme } from '@mui/material/styles';

/**
 * Application theme: the one place for colour, type, shape and component defaults.
 *
 * Two colour schemes (light and dark) are published as CSS variables, so switching mode repaints
 * without re-rendering. Status colours (success, warning, error) are reserved for status.
 */
const FONT = '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#4f46e5', light: '#6366f1', dark: '#3730a3' },
        secondary: { main: '#7c3aed', light: '#8b5cf6', dark: '#5b21b6' },
        success: { main: '#15803d', light: '#22c55e', dark: '#14532d' },
        warning: { main: '#b45309', light: '#f59e0b', dark: '#7c2d12' },
        error: { main: '#c62828', light: '#ef4444', dark: '#8e1b1b' },
        info: { main: '#0369a1', light: '#0ea5e9', dark: '#0c4a6e' },
        background: { default: '#f5f6fa', paper: '#ffffff' },
        text: { primary: '#0f172a', secondary: '#4a5568' },
        divider: '#e3e7ef',
      },
    },
    dark: {
      palette: {
        primary: { main: '#818cf8', light: '#a5b4fc', dark: '#6366f1' },
        secondary: { main: '#a78bfa', light: '#c4b5fd', dark: '#8b5cf6' },
        success: { main: '#4ade80', light: '#86efac', dark: '#22c55e' },
        warning: { main: '#fbbf24', light: '#fcd34d', dark: '#f59e0b' },
        error: { main: '#f87171', light: '#fca5a5', dark: '#ef4444' },
        info: { main: '#38bdf8', light: '#7dd3fc', dark: '#0ea5e9' },
        background: { default: '#0b1020', paper: '#131a2e' },
        text: { primary: '#e5e9f2', secondary: '#9aa6bd' },
        divider: 'rgba(148, 163, 184, 0.18)',
      },
    },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: FONT,
    h1: { fontSize: '1.625rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.375rem', fontWeight: 700, letterSpacing: '-0.01em' },
    h3: { fontSize: '1rem', fontWeight: 650 },
    body1: { fontSize: '0.9375rem' },
    body2: { fontSize: '0.8125rem' },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 8 } } },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderRadius: 14 } },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiAppBar: { defaultProps: { elevation: 0, color: 'inherit' } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiOutlinedInput: { styleOverrides: { root: ({ theme: t }) => ({ backgroundColor: t.vars.palette.background.paper }) } },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
    MuiTab: { styleOverrides: { root: { fontWeight: 600, minHeight: 44 } } },
    MuiTabs: { styleOverrides: { root: ({ theme: t }) => ({ minHeight: 44, borderBottom: `1px solid ${t.vars.palette.divider}` }) } },
    MuiLinearProgress: { styleOverrides: { root: { borderRadius: 999 } } },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 12 } } },
    MuiDataGrid: {
      styleOverrides: {
        root: ({ theme: t }) => ({
          border: 0,
          '--DataGrid-containerBackground': 'transparent',
          '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600, fontSize: '0.75rem', letterSpacing: '0.04em', textTransform: 'uppercase', color: t.vars.palette.text.secondary },
          '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center' },
          '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within, & .MuiDataGrid-columnHeader:focus': { outline: 'none' },
          '& .MuiDataGrid-row:hover': { backgroundColor: t.vars.palette.action.hover },
        }),
      },
    },
  },
});

export default theme;

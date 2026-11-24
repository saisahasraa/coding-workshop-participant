import { Fragment, Suspense, useState } from 'react';
import PropTypes from 'prop-types';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useMediaQuery } from 'react-responsive';
import { useColorScheme } from '@mui/material/styles';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import { labelize } from '../utils/format';
import { initials } from '../utils/people';
import ErrorBoundary from './ErrorBoundary';

const DRAWER_WIDTH = 248;
const RAIL_WIDTH = 72;
const CONTENT_MAX_WIDTH = 1560;
const COLLAPSED_KEY = 'acme.navCollapsed';

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Breakpoint (px) at which the navigation drawer becomes permanent. */
export const DESKTOP_MIN_WIDTH = 900;

/** Light/dark switch. Until someone uses it, the app follows the system setting. */
function ColorModeToggle() {
  const { mode, systemMode, setMode } = useColorScheme();
  const current = (mode === 'system' ? systemMode : mode) || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  return (
    <Tooltip title={`Switch to ${next} mode`}>
      <IconButton aria-label={`Switch to ${next} mode`} onClick={() => setMode(next)}>
        {current === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
      </IconButton>
    </Tooltip>
  );
}

/**
 * Responsive application frame: top bar, sectioned navigation and the routed page content.
 * Desktop: permanent drawer that collapses to an icon rail (remembered). Mobile: slide-over drawer.
 */
function AppShell({ appName, navItems, user = null, onLogout = null, search = null }) {
  const isDesktop = useMediaQuery({ minWidth: DESKTOP_MIN_WIDTH });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const location = useLocation();
  const rail = isDesktop && collapsed;
  const width = rail ? RAIL_WIDTH : DRAWER_WIDTH;

  const toggleNav = () => {
    if (!isDesktop) {
      setMobileOpen(true);
      return;
    }
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, String(!value));
      } catch {
        // ignore unavailable storage
      }
      return !value;
    });
  };

  const navigation = (
    <Box component="nav" aria-label="Main navigation" sx={{ px: 1.5, pb: 2 }}>
      <Toolbar />
      <List disablePadding component="div">
        {navItems.map((item, index) => {
          const startsSection = item.section && item.section !== navItems[index - 1]?.section;
          return (
            <Fragment key={item.to}>
              {startsSection && (rail
                ? <Divider sx={{ my: 1 }} />
                : <Typography
                variant="overline"
                sx={{
                  color: "text.secondary",
                  display: 'block',
                  px: 1.5,
                  pt: 2,
                  pb: 0.5,
                  lineHeight: 1.6,
                  letterSpacing: '0.08em'
                }}>{item.section}</Typography>)}
              <Tooltip title={rail ? item.label : ''} placement="right">
                <ListItemButton
                  component={NavLink}
                  to={item.to}
                  end={item.to === '/'}
                  aria-label={rail ? item.label : undefined}
                  onClick={() => setMobileOpen(false)}
                  sx={(theme) => ({
                    borderRadius: 2, mb: 0.25, py: 0.75, justifyContent: rail ? 'center' : 'flex-start', color: 'text.secondary',
                    '& .MuiListItemIcon-root': { color: 'inherit', minWidth: rail ? 0 : 36 },
                    '& .MuiListItemText-primary': { fontSize: '0.875rem', fontWeight: 500 },
                    '&.active': {
                      color: 'primary.main', backgroundColor: `rgba(${theme.vars.palette.primary.mainChannel} / 0.1)`,
                      '& .MuiListItemText-primary': { fontWeight: 650 },
                    },
                  })}
                >
                  <ListItemIcon>{item.icon}</ListItemIcon>
                  {!rail && <ListItemText primary={item.label} />}
                </ListItemButton>
              </Tooltip>
            </Fragment>
          );
        })}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Link
        href="#main-content"
        sx={{ position: 'absolute', left: -9999, '&:focus': { left: 8, top: 8, zIndex: 2000, bgcolor: 'background.paper', p: 1 } }}
      >
        Skip to content
      </Link>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Toolbar sx={{ gap: 1 }}>
          <IconButton
            edge="start"
            aria-label={isDesktop ? (collapsed ? 'Expand navigation' : 'Collapse navigation') : 'Open navigation'}
            aria-expanded={isDesktop ? !collapsed : mobileOpen}
            onClick={toggleNav}
          >
            {isDesktop && !collapsed ? <MenuOpenIcon /> : <MenuIcon />}
          </IconButton>
          <Box aria-hidden sx={{
            width: 30, height: 30, borderRadius: 2, display: { xs: 'none', sm: 'grid' }, placeItems: 'center', flexShrink: 0,
            color: 'primary.contrastText', fontWeight: 800, fontSize: 15,
            background: (t) => `linear-gradient(135deg, ${t.vars.palette.primary.main}, ${t.vars.palette.secondary.main})`,
          }}>
            {appName.charAt(0)}
          </Box>
          <Typography variant="h3" component="span" noWrap sx={{ display: { xs: 'none', sm: 'block' }, minWidth: { md: 170 } }}>{appName}</Typography>
          <Box sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>{search}</Box>
          <ColorModeToggle />
          {user && (
            <>
              <IconButton aria-label="Account menu" onClick={(e) => setMenuAnchor(e.currentTarget)} sx={{ p: 0.5 }}>
                <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', color: 'primary.contrastText', fontSize: 13, fontWeight: 700 }}>
                  {initials(user.name)}
                </Avatar>
              </IconButton>
              <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
                <Box sx={{ px: 2, py: 1 }}>
                  <Typography sx={{
                    fontWeight: 600
                  }}>{user.name}</Typography>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>{labelize(user.role)}</Typography>
                </Box>
                <Divider />
                <MenuItem component={NavLink} to="/profile" onClick={() => setMenuAnchor(null)}>Profile</MenuItem>
                {onLogout && <MenuItem onClick={() => { setMenuAnchor(null); onLogout(); }}>Sign out</MenuItem>}
              </Menu>
            </>
          )}
        </Toolbar>
      </AppBar>

      <Drawer
        variant={isDesktop ? 'permanent' : 'temporary'}
        open={isDesktop || mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          width, flexShrink: 0, transition: 'width 150ms',
          '& .MuiDrawer-paper': { width, boxSizing: 'border-box', overflowX: 'hidden', transition: 'width 150ms', bgcolor: 'background.paper' },
        }}
      >
        {navigation}
      </Drawer>

      <Box component="main" id="main-content" tabIndex={-1} sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 }, outline: 'none' }}>
        <Toolbar />
        <Box sx={{ maxWidth: CONTENT_MAX_WIDTH, mx: 'auto' }}>
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<LinearProgress aria-label="Loading page" />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </Box>
      </Box>
    </Box>
  );
}

AppShell.propTypes = {
  /** Name shown in the top bar. */
  appName: PropTypes.string.isRequired,
  /** Navigation entries in display order; a new `section` value starts a labelled group. */
  navItems: PropTypes.arrayOf(PropTypes.shape({
    label: PropTypes.string.isRequired,
    to: PropTypes.string.isRequired,
    icon: PropTypes.node,
    section: PropTypes.string,
  })).isRequired,
  /** Signed-in user shown in the account menu. */
  user: PropTypes.shape({ name: PropTypes.string.isRequired, role: PropTypes.string.isRequired }),
  /** Called when the user chooses "Sign out". */
  onLogout: PropTypes.func,
  /** Search box shown in the top bar. */
  search: PropTypes.node,
};

export default AppShell;

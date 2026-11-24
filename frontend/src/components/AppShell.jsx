import { Suspense, useState } from 'react';
import PropTypes from 'prop-types';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useMediaQuery } from 'react-responsive';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Avatar from '@mui/material/Avatar';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import Tooltip from '@mui/material/Tooltip';
import { labelize } from '../utils/format';
import ErrorBoundary from './ErrorBoundary';

const DRAWER_WIDTH = 240;
const RAIL_WIDTH = 68;
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

/**
 * Responsive application frame: top bar, navigation drawer and the routed page content.
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
    <Box component="nav" aria-label="Main navigation">
      <Toolbar />
      <List>
        {navItems.map((item) => (
          <Tooltip key={item.to} title={rail ? item.label : ''} placement="right">
            <ListItemButton
              component={NavLink}
              to={item.to}
              end={item.to === '/'}
              aria-label={rail ? item.label : undefined}
              onClick={() => setMobileOpen(false)}
              sx={{
                mx: 1, borderRadius: 1, justifyContent: rail ? 'center' : 'flex-start',
                '&.active': { bgcolor: 'action.selected', fontWeight: 600 },
              }}
            >
              <ListItemIcon sx={{ minWidth: rail ? 0 : 40 }}>{item.icon}</ListItemIcon>
              {!rail && <ListItemText primary={item.label} />}
            </ListItemButton>
          </Tooltip>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Link
        href="#main-content"
        sx={{ position: 'absolute', left: -9999, '&:focus': { left: 8, top: 8, zIndex: 2000, bgcolor: 'background.paper', p: 1 } }}
      >
        Skip to content
      </Link>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1, borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar>
          <IconButton
            edge="start"
            aria-label={isDesktop ? (collapsed ? 'Expand navigation' : 'Collapse navigation') : 'Open navigation'}
            aria-expanded={isDesktop ? !collapsed : mobileOpen}
            onClick={toggleNav}
            sx={{ mr: 1 }}
          >
            {isDesktop && !collapsed ? <MenuOpenIcon /> : <MenuIcon />}
          </IconButton>
          <Typography variant="h3" component="span" noWrap sx={{ flexGrow: { xs: 0, sm: 1 }, display: { xs: 'none', sm: 'block' } }}>{appName}</Typography>
          <Box sx={{ flexGrow: 1, display: 'flex', justifyContent: 'flex-end' }}>{search}</Box>
          {user && (
            <>
              <IconButton aria-label="Account menu" onClick={(e) => setMenuAnchor(e.currentTarget)}>
                <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>
                  {user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                </Avatar>
              </IconButton>
              <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
                <Box sx={{ px: 2, py: 1 }}>
                  <Typography fontWeight={600}>{user.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{labelize(user.role)}</Typography>
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
          '& .MuiDrawer-paper': { width, boxSizing: 'border-box', overflowX: 'hidden', transition: 'width 150ms' },
        }}
      >
        {navigation}
      </Drawer>

      <Box component="main" id="main-content" tabIndex={-1} sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 } }}>
        <Toolbar />
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<LinearProgress aria-label="Loading page" />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </Box>
    </Box>
  );
}

AppShell.propTypes = {
  /** Name shown in the top bar. */
  appName: PropTypes.string.isRequired,
  /** Navigation entries in display order. */
  navItems: PropTypes.arrayOf(PropTypes.shape({
    label: PropTypes.string.isRequired,
    to: PropTypes.string.isRequired,
    icon: PropTypes.node,
  })).isRequired,
  /** Signed-in user shown in the account menu. */
  user: PropTypes.shape({ name: PropTypes.string.isRequired, role: PropTypes.string.isRequired }),
  /** Called when the user chooses "Sign out". */
  onLogout: PropTypes.func,
  /** Search box shown in the top bar. */
  search: PropTypes.node,
};

export default AppShell;

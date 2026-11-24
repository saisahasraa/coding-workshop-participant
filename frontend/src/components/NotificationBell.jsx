import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';
import { fetchNotifications, markNotificationsRead } from '../api/collab';
import { formatDateTime } from '../utils/format';

const REFRESH_MS = 60000;

/** The bell: what changed on work you are part of. Checks for news every minute and when opened. */
export default function NotificationBell() {
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(null);
  const [inbox, setInbox] = useState({ data: [], unread: 0 });

  const load = useCallback(() => fetchNotifications().then(setInbox).catch(() => {}), []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const open = (item) => {
    setAnchor(null);
    if (!item.read_at) markNotificationsRead([item.id]).then(load).catch(() => {});
    if (item.link) navigate(item.link);
  };

  const label = inbox.unread ? `Notifications, ${inbox.unread} unread` : 'Notifications';
  return (
    <>
      <Tooltip title="Notifications">
        <IconButton aria-label={label} onClick={(e) => { setAnchor(e.currentTarget); load(); }}>
          <Badge badgeContent={inbox.unread} color="error" max={99}><NotificationsNoneOutlinedIcon /></Badge>
        </IconButton>
      </Tooltip>
      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 380, maxWidth: 'calc(100vw - 24px)' } } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="h3" component="h2">Notifications</Typography>
          <Button size="small" disabled={!inbox.unread} onClick={() => markNotificationsRead().then(load).catch(() => {})}>Mark all read</Button>
        </Box>
        {!inbox.data.length && <Typography sx={{ color: 'text.secondary', p: 2 }}>Nothing yet. You will hear about changes to work you are part of.</Typography>}
        <List disablePadding sx={{ maxHeight: 420, overflowY: 'auto' }}>
          {inbox.data.map((item) => (
            <ListItemButton key={item.id} onClick={() => open(item)} sx={{ alignItems: 'flex-start', gap: 1.25, py: 1.25 }}>
              <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', mt: 0.9, flexShrink: 0, bgcolor: item.read_at ? 'transparent' : 'primary.main' }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: item.read_at ? 400 : 600, overflowWrap: 'anywhere' }}>{item.message}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>{formatDateTime(item.created_at)}{!item.read_at && ' · unread'}</Typography>
              </Box>
            </ListItemButton>
          ))}
        </List>
      </Popover>
    </>
  );
}

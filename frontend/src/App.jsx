import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined';
import AppShell from './components/AppShell';
import { DEFAULT_APP_NAME } from './config';

// Pages are lazy-loaded so each route only downloads its own code.
const StatusPage = lazy(() => import('./features/status/StatusPage'));
const NotFoundPage = lazy(() => import('./features/NotFoundPage'));

const NAV_ITEMS = [
  { label: 'System status', to: '/', icon: <MonitorHeartOutlinedIcon /> },
];

/** Route table. */
export default function App() {
  return (
    <Routes>
      <Route element={<AppShell appName={DEFAULT_APP_NAME} navItems={NAV_ITEMS} />}>
        <Route index element={<StatusPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined';
import AssignmentTurnedInOutlinedIcon from '@mui/icons-material/AssignmentTurnedInOutlined';
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined';
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined';
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined';
import { useAuth } from './auth/AuthContext';
import LoginPage from './auth/LoginPage';
import RequireAuth from './auth/RequireAuth';
import AppShell from './components/AppShell';
import { useMeta } from './meta/MetaContext';

// Pages are lazy-loaded so each route only downloads its own code.
const ProjectsPage = lazy(() => import('./features/projects/ProjectsPage'));
const ProjectDetailPage = lazy(() => import('./features/projects/ProjectDetailPage'));
const DeliverablesPage = lazy(() => import('./features/deliverables/DeliverablesPage'));
const DeliverableDetailPage = lazy(() => import('./features/deliverables/DeliverableDetailPage'));
const MyWorkPage = lazy(() => import('./features/deliverables/MyWorkPage'));
const UsersPage = lazy(() => import('./features/admin/UsersPage'));
const DepartmentsPage = lazy(() => import('./features/admin/DepartmentsPage'));
const ProfilePage = lazy(() => import('./features/profile/ProfilePage'));
const StatusPage = lazy(() => import('./features/status/StatusPage'));
const NotFoundPage = lazy(() => import('./features/NotFoundPage'));

/** Navigation entries, each shown only when the role can use it. */
const NAV = [
  { label: 'Projects', to: '/projects', icon: <AccountTreeOutlinedIcon />, visible: () => true },
  { label: 'Deliverables', to: '/deliverables', icon: <ChecklistOutlinedIcon />, visible: () => true },
  { label: 'My work', to: '/my-work', icon: <AssignmentTurnedInOutlinedIcon />, visible: (can) => can('deliverables', 'update') },
  { label: 'Users', to: '/admin/users', icon: <PeopleAltOutlinedIcon />, visible: (can) => can('users', 'create') },
  { label: 'Departments', to: '/admin/departments', icon: <ApartmentOutlinedIcon />, visible: (can) => can('departments', 'create') },
  { label: 'System status', to: '/status', icon: <MonitorHeartOutlinedIcon />, visible: () => true },
];

function Shell() {
  const { user, can, logout } = useAuth();
  const { appName } = useMeta();
  const navItems = NAV.filter((item) => item.visible(can)).map(({ label, to, icon }) => ({ label, to, icon }));
  return <AppShell appName={appName} navItems={navItems} user={user} onLogout={logout} />;
}

/** Route table. */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><Shell /></RequireAuth>}>
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="deliverables" element={<DeliverablesPage />} />
        <Route path="deliverables/:id" element={<DeliverableDetailPage />} />
        <Route path="my-work" element={<MyWorkPage />} />
        <Route path="admin/users" element={<RequireAuth resource="users" action="create"><UsersPage /></RequireAuth>} />
        <Route path="admin/departments" element={<RequireAuth resource="departments" action="create"><DepartmentsPage /></RequireAuth>} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="status" element={<StatusPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

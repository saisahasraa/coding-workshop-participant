import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import AssignmentTurnedInOutlinedIcon from '@mui/icons-material/AssignmentTurnedInOutlined';
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined';
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined';
import { useAuth } from './auth/AuthContext';
import LoginPage from './auth/LoginPage';
import RequireAuth from './auth/RequireAuth';
import AppShell from './components/AppShell';
import GlobalSearch from './components/GlobalSearch';
import { useMeta } from './meta/MetaContext';

// Pages are lazy-loaded so each route only downloads its own code.
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'));
const SettingsPage = lazy(() => import('./features/admin/SettingsPage'));
const AuditLogPage = lazy(() => import('./features/admin/AuditLogPage'));
const ProjectsPage = lazy(() => import('./features/projects/ProjectsPage'));
const ProjectDetailPage = lazy(() => import('./features/projects/ProjectDetailPage'));
const DeliverablesPage = lazy(() => import('./features/deliverables/DeliverablesPage'));
const DeliverableDetailPage = lazy(() => import('./features/deliverables/DeliverableDetailPage'));
const TeamsPage = lazy(() => import('./features/teams/TeamsPage'));
const TeamDetailPage = lazy(() => import('./features/teams/TeamDetailPage'));
const LeavePage = lazy(() => import('./features/leave/LeavePage'));
const CapacityPage = lazy(() => import('./features/capacity/CapacityPage'));
const BudgetPage = lazy(() => import('./features/budget/BudgetPage'));
const MyWorkPage = lazy(() => import('./features/deliverables/MyWorkPage'));
const UsersPage = lazy(() => import('./features/admin/UsersPage'));
const DepartmentsPage = lazy(() => import('./features/admin/DepartmentsPage'));
const ProfilePage = lazy(() => import('./features/profile/ProfilePage'));
const StatusPage = lazy(() => import('./features/status/StatusPage'));
const NotFoundPage = lazy(() => import('./features/NotFoundPage'));

/** Navigation entries, each shown only when the role can use it. */
const NAV = [
  { label: 'Dashboard', to: '/', icon: <DashboardOutlinedIcon />, visible: () => true },
  { label: 'Projects', to: '/projects', icon: <AccountTreeOutlinedIcon />, visible: () => true },
  { label: 'Deliverables', to: '/deliverables', icon: <ChecklistOutlinedIcon />, visible: () => true },
  { label: 'My work', to: '/my-work', icon: <AssignmentTurnedInOutlinedIcon />, visible: (can) => can('deliverables', 'update') },
  { label: 'Teams', to: '/teams', icon: <GroupsOutlinedIcon />, visible: () => true },
  { label: 'Capacity', to: '/capacity', icon: <InsightsOutlinedIcon />, visible: () => true },
  { label: 'Budget', to: '/budget', icon: <AccountBalanceWalletOutlinedIcon />, visible: () => true },
  { label: 'Leave', to: '/leave', icon: <EventBusyOutlinedIcon />, visible: () => true },
  { label: 'Users', to: '/admin/users', icon: <PeopleAltOutlinedIcon />, visible: (can) => can('users', 'create') },
  { label: 'Departments', to: '/admin/departments', icon: <ApartmentOutlinedIcon />, visible: (can) => can('departments', 'create') },
  { label: 'Settings', to: '/admin/settings', icon: <AdminPanelSettingsOutlinedIcon />, visible: (can) => can('settings', 'update') },
  { label: 'Audit log', to: '/admin/audit', icon: <HistoryOutlinedIcon />, visible: (can) => can('audit-log', 'read') },
  { label: 'System status', to: '/status', icon: <MonitorHeartOutlinedIcon />, visible: () => true },
];

function Shell() {
  const { user, can, logout } = useAuth();
  const { appName } = useMeta();
  const navItems = NAV.filter((item) => item.visible(can)).map(({ label, to, icon }) => ({ label, to, icon }));
  return <AppShell appName={appName} navItems={navItems} user={user} onLogout={logout} search={<GlobalSearch />} />;
}

/** Route table. */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><Shell /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="deliverables" element={<DeliverablesPage />} />
        <Route path="deliverables/:id" element={<DeliverableDetailPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="teams/:id" element={<TeamDetailPage />} />
        <Route path="capacity" element={<CapacityPage />} />
        <Route path="budget" element={<BudgetPage />} />
        <Route path="leave" element={<LeavePage />} />
        <Route path="my-work" element={<MyWorkPage />} />
        <Route path="admin/users" element={<RequireAuth resource="users" action="create"><UsersPage /></RequireAuth>} />
        <Route path="admin/departments" element={<RequireAuth resource="departments" action="create"><DepartmentsPage /></RequireAuth>} />
        <Route path="admin/settings" element={<RequireAuth resource="settings" action="update"><SettingsPage /></RequireAuth>} />
        <Route path="admin/audit" element={<RequireAuth resource="audit-log" action="read"><AuditLogPage /></RequireAuth>} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="status" element={<StatusPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

/** Canned API data for tests. */
import { http, HttpResponse } from 'msw';
import { apiUrl } from './server';

export const META = {
  roles: ['admin', 'project_manager', 'team_lead', 'team_member', 'viewer'],
  project_statuses: ['planning', 'active', 'on_hold', 'completed', 'cancelled'],
  deliverable_statuses: [
    { value: 'not_started', category: 'todo' }, { value: 'in_progress', category: 'active' },
    { value: 'blocked', category: 'blocked' }, { value: 'completed', category: 'done' },
  ],
  priorities: ['low', 'medium', 'high', 'critical'],
  visibilities: ['inherit', 'everyone', 'members'],
  settings: { 'app.name': 'ACME Test Tracker', 'budget.currency': 'USD', 'auth.password_min_length': 8, 'capacity.default_weekly_hours': 40 },
};

const ALL = ['create', 'delete', 'read', 'update'];
export const PERMISSIONS = {
  admin: { users: ALL, departments: ALL, projects: ALL, deliverables: ALL, settings: ['read', 'update'], audit_log: ['read'] },
  project_manager: { users: ['read'], departments: ['read'], projects: ALL, deliverables: ALL },
  team_member: { users: ['read'], departments: ['read'], projects: ['read'], deliverables: ['read', 'update'] },
  viewer: { users: ['read'], departments: ['read'], projects: ['read'], deliverables: ['read'] },
};

export const userFor = (role, id = 1) => ({
  id, email: `${role}@acme.example`, name: `${role === 'admin' ? 'Ada' : 'Pat'} ${role.replace('_', ' ')}`, role,
  job_title: null, weekly_capacity_hours: 40, is_active: true, can_login: true,
});

export const PROJECT = {
  id: 7, key: 'WEB', name: 'Website relaunch', description: 'New site', department_id: 1, department_name: 'Marketing',
  manager_id: 2, manager_name: 'Alice Morgan', status: 'active', priority: 'high', start_date: '2026-01-01',
  end_date: '2026-06-30', planned_budget: 120000, visibility: 'inherit', completed_at: null, progress_pct: 56,
  deliverables_total: 2, deliverables_completed: 1, deliverables_blocked: 0, deliverables_overdue: 1,
  permissions: { update: true, delete: true, editable_fields: null },
};

export const DELIVERABLE = {
  id: 11, key: 'WEB-3', number: 3, project_id: 7, project_key: 'WEB', project_name: 'Website relaunch', project_manager_id: 2,
  project_start_date: '2026-01-01', project_end_date: '2026-06-30', name: 'Design system',
  description: null, acceptance_criteria: null, owner_id: 1, owner_name: 'Pat team member', reporter_id: 2, reporter_name: 'Alice Morgan', status: 'in_progress', priority: 'high', due_date: '2026-01-10',
  estimated_hours: 80, progress_pct: 70, completed_at: null, is_overdue: true, created_at: '2026-01-02T10:00:00Z', updated_at: '2026-01-05T10:00:00Z',
  permissions: { update: true, delete: false, editable_fields: ['progress_pct', 'status'] },
};

export const page = (data) => ({ data, total: data.length, limit: 25, offset: 0 });

/**
 * MSW handlers for a signed-in session of `role` (refresh token in storage is required).
 * @param {string} role
 */
export function sessionHandlers(role) {
  const user = userFor(role);
  return [
    http.post(apiUrl('/auth/refresh'), () => HttpResponse.json({ access_token: 'access-1', refresh_token: 'refresh-2', user })),
    http.get(apiUrl('/auth/me'), () => HttpResponse.json({ user, permissions: PERMISSIONS[role] })),
    http.get(apiUrl('/meta'), () => HttpResponse.json(META)),
  ];
}

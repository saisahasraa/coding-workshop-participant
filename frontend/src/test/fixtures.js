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
  settings: {
    'app.name': 'ACME Test Tracker', 'budget.currency': 'USD', 'auth.password_min_length': 8, 'capacity.default_weekly_hours': 40,
    'leaves.types': ['vacation', 'sick', 'training', 'other'], 'budget.expense_categories': ['labor', 'software', 'travel'],
  },
};

const ALL = ['create', 'delete', 'read', 'update'];
const RU = ['read', 'update'];
export const PERMISSIONS = {
  admin: { users: ALL, departments: ALL, teams: ALL, projects: ALL, deliverables: ALL, leaves: ALL, expenses: ALL, settings: RU, audit_log: ['read'] },
  project_manager: { users: ['read'], departments: ['read'], teams: ['read'], projects: ALL, deliverables: ALL, leaves: ['read'], expenses: ALL },
  team_lead: { users: RU, departments: ['read'], teams: ['read'], projects: ['read'], deliverables: RU, leaves: ALL, expenses: ['read'] },
  team_member: { users: ['read'], departments: ['read'], teams: ['read'], projects: ['read'], deliverables: RU, leaves: ALL, expenses: ['read'] },
  viewer: { users: ['read'], departments: ['read'], teams: ['read'], projects: ['read'], deliverables: ['read'], leaves: ['read'], expenses: ['read'] },
};

export const userFor = (role, id = 1) => ({
  id, email: `${role}@acme.example`, name: `${role === 'admin' ? 'Ada' : 'Pat'} ${role.replace('_', ' ')}`, role,
  job_title: null, weekly_capacity_hours: 40, is_active: true, can_login: true,
});

export const PROJECT = {
  id: 7, key: 'WEB', name: 'Website relaunch', description: 'New site', department_id: 1, department_name: 'Marketing',
  manager_id: 2, manager_name: 'Alice Morgan', status: 'active', priority: 'high', start_date: '2026-01-01',
  end_date: '2026-06-30', planned_budget: 120000, visibility: 'inherit', completed_at: null, progress_pct: 56,
  budget_spent: 84000, budget_burn_pct: 70, schedule_elapsed_pct: 60, health: 'amber',
  health_reasons: [{ level: 'amber', code: 'overdue', message: '1 deliverable overdue, the longest by 3 days' }],
  deliverables_total: 2, deliverables_completed: 1, deliverables_blocked: 0, deliverables_overdue: 1,
  permissions: { update: true, delete: true, editable_fields: null },
};

export const DELIVERABLE = {
  id: 11, key: 'WEB-3', number: 3, project_id: 7, project_key: 'WEB', project_name: 'Website relaunch', project_manager_id: 2,
  project_start_date: '2026-01-01', project_end_date: '2026-06-30', name: 'Design system',
  description: null, acceptance_criteria: null, owner_id: 1, owner_name: 'Pat team member', reporter_id: 2, reporter_name: 'Alice Morgan', status: 'in_progress', priority: 'high', due_date: '2026-01-10',
  estimated_hours: 80, progress_pct: 70, completed_at: null, is_overdue: true, open_blockers: 0, created_at: '2026-01-02T10:00:00Z', updated_at: '2026-01-05T10:00:00Z',
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

const FULL = { update: true, delete: true, editable_fields: null };

export const TEAM = {
  id: 3, department_id: 1, department_name: 'Engineering', name: 'Platform', lead_id: 1, lead_name: 'Pat team lead', member_count: 2,
  permissions: { update: false, delete: false, editable_fields: [] },
};

export const MEMBER = {
  id: 5, name: 'Dan Okafor', email: 'dan@acme.example', role: 'team_member', job_title: 'Backend Engineer', weekly_capacity_hours: 40,
  team_id: 3, is_active: true, permissions: { update: true, delete: false, editable_fields: ['weekly_capacity_hours'] },
};

export const LEAVE = {
  id: 21, user_id: 5, user_name: 'Dan Okafor', team_id: 3, team_lead_id: 1, type: 'vacation', start_date: '2026-03-09', end_date: '2026-03-11',
  note: 'Family trip', permissions: { update: true, delete: true, editable_fields: ['end_date', 'note', 'start_date', 'type'] },
};

const person = (id, name, over, utilization, projects, uncounted = 0) => ({
  user_id: id, name, role: 'team_member', job_title: null, team_id: 3, team_name: 'Platform', weekly_capacity_hours: 40,
  capacity_hours: 80, leave_days: over ? 3 : 0, leave_hours: over ? 24 : 0, available_hours: over ? 56 : 80, allocated_hours: over ? 88 : 40,
  free_hours: over ? -32 : 40, utilization_pct: utilization, over_allocated: over, uncounted_count: uncounted, projects,
});

export const CAPACITY = {
  from: '2026-03-02', to: '2026-03-13', working_days: [1, 2, 3, 4, 5], threshold_pct: 100,
  data: [
    person(6, 'Erin Walsh', false, 50, [{ project_id: 7, key: 'WEB', name: 'Website relaunch', hours: 40 }], 2),
    person(5, 'Dan Okafor', true, 157.1, [{ project_id: 7, key: 'WEB', name: 'Website relaunch', hours: 48 }, { project_id: null, key: null, name: 'Other projects', hours: 40 }]),
  ],
  summary: { people: 2, over_allocated: 1, capacity_hours: 160, available_hours: 136, allocated_hours: 128, leave_hours: 24 },
};

export { FULL };

const row = (id, key, name, status, due, hours, progress, overdue = false) => ({
  id, key, name, status, priority: 'high', due_date: due, estimated_hours: hours, progress_pct: progress, is_overdue: overdue,
});

export const PROJECT_TEAM = {
  project: { id: 7, key: 'WEB', name: 'Website relaunch' },
  truncated: false,
  data: [
    {
      user_id: 5, name: 'Dan Okafor', role: 'team_member', job_title: 'Backend Engineer', deliverables_total: 2, deliverables_open: 1,
      deliverables_completed: 1, overdue: 1, estimated_hours: 50, remaining_hours: 20,
      deliverables: [row(11, 'WEB-3', 'Design system', 'in_progress', '2026-01-10', 40, 50, true), row(12, 'WEB-4', 'Launch campaign', 'completed', '2026-01-02', 10, 100)],
    },
    {
      user_id: null, name: 'Unassigned', role: null, job_title: null, deliverables_total: 1, deliverables_open: 1, deliverables_completed: 0,
      overdue: 0, estimated_hours: 0, remaining_hours: 0, deliverables: [row(13, 'WEB-5', 'Accessibility audit', 'not_started', null, null, 0)],
    },
  ],
};

export const EXPENSE = {
  id: 31, project_id: 7, project_key: 'WEB', project_name: 'Website relaunch', amount: '1200.00', category: 'software', spent_on: '2026-03-10',
  description: 'Licences', created_by_name: 'Alice Morgan', permissions: { update: true, delete: true, editable_fields: ['amount', 'category', 'description', 'spent_on'] },
};

export const BUDGET = {
  totals: { projects: 2, planned_budget: 150000, spent: 120000, remaining: 30000, burn_pct: 80, over_budget: 1 },
  data: [
    { id: 7, key: 'WEB', name: 'Website relaunch', status: 'active', department_name: 'Marketing', planned_budget: 120000, spent: 84000, remaining: 36000, burn_pct: 70, progress_pct: 56, over_budget: false, health: 'amber' },
    { id: 8, key: 'PAY', name: 'Payments', status: 'active', department_name: 'Finance', planned_budget: 30000, spent: 36000, remaining: -6000, burn_pct: 120, progress_pct: 40, over_budget: true, health: 'red' },
  ],
  by_category: [{ category: 'labor', amount: 90000 }, { category: 'software', amount: 30000 }],
  by_month: [{ month: '2026-02', amount: 70000 }, { month: '2026-03', amount: 50000 }],
};

const node = (key, name, status, depth, extra = {}) => ({
  id: depth + 100, key, name, status, priority: 'high', due_date: null, project_key: key.split('-')[0], owner_name: null,
  open_blockers: 0, depth, external: false, ready: status !== 'completed', ...extra,
});

export const DEPENDENCIES = {
  project: { id: 7, key: 'WEB', name: 'Website relaunch' },
  nodes: [
    node('WEB-1', 'Design system', 'completed', 0, { ready: false }),
    node('WEB-2', 'Build pages', 'in_progress', 1),
    node('WEB-3', 'Content import', 'not_started', 1, { open_blockers: 1, ready: false }),
    node('OPS-4', 'Provision hosting', 'in_progress', 0, { external: true }),
  ],
  edges: [{ source: 'WEB-1', target: 'WEB-2' }, { source: 'WEB-1', target: 'WEB-3' }, { source: 'OPS-4', target: 'WEB-3' }],
  longest_chain: 2,
};

/** REST resources: one generic client per collection. */
import { api } from './client';

/**
 * Build CRUD helpers for `/name`.
 * @param {string} name Collection path segment, e.g. `projects`
 */
export function resourceApi(name) {
  const base = `/${name}`;
  return {
    list: (query, signal) => api.get(base, { query, signal }),
    get: (id, signal) => api.get(`${base}/${id}`, { signal }),
    create: (body) => api.post(base, body),
    update: (id, changes) => api.put(`${base}/${id}`, changes),
    remove: (id) => api.delete(`${base}/${id}`),
  };
}

export const usersApi = resourceApi('users');
export const departmentsApi = resourceApi('departments');
export const projectsApi = resourceApi('projects');
export const deliverablesApi = resourceApi('deliverables');
export const teamsApi = resourceApi('teams');
export const leavesApi = resourceApi('leaves');
export const expensesApi = resourceApi('expenses');

/**
 * Capacity report for a window.
 * @param {{from?: string, to?: string, team_id?: string, department_id?: string}} query
 */
/** People working on a project, with their deliverables there. @param {string} ref project key or id */
export const fetchProjectTeam = (ref, signal) => api.get(`/projects/${encodeURIComponent(ref)}/team`, { signal });

export const fetchCapacity = (query, signal) => api.get('/reports/capacity', { query, signal });

/** @returns {Promise<object>} enumerations and public settings */
export const fetchMeta = (signal) => api.get('/meta', { signal });

/**
 * Planned vs spent, by project, category and month.
 * @param {{project_id?: string, department_id?: string}} query
 */
export const fetchBudget = (query, signal) => api.get('/reports/budget', { query, signal });

/** Blocking graph of a project. @param {string} ref project key or id */
export const fetchDependencies = (ref, signal) => api.get(`/projects/${encodeURIComponent(ref)}/dependencies`, { signal });

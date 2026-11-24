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

/** @returns {Promise<object>} enumerations and public settings */
export const fetchMeta = (signal) => api.get('/meta', { signal });

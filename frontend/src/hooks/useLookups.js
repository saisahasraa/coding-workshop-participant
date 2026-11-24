import { useEffect, useState } from 'react';
import { departmentsApi, usersApi } from '../api/resources';

const LOADERS = {
  departments: (signal) => departmentsApi.list({ limit: 200, sort: 'name' }, signal),
  managers: (signal) => usersApi.list({ role: 'project_manager,admin', is_active: true, limit: 200, sort: 'name' }, signal),
  people: (signal) => usersApi.list({ is_active: true, limit: 200, sort: 'name' }, signal),
  assignees: (signal) => usersApi.list({ role: 'admin,project_manager,team_lead,team_member', is_active: true, limit: 200, sort: 'name' }, signal),
};

/**
 * Load option lists (id/name pairs) for form selects while `enabled`.
 * @param {Array<'departments'|'managers'|'assignees'|'people'>} names
 * @param {boolean} enabled
 * @returns {Object<string, {value: number, label: string}[]>}
 */
export default function useLookups(names, enabled) {
  const [lookups, setLookups] = useState({});
  const key = names.join(',');

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    Promise.all(key.split(',').map((name) => LOADERS[name](controller.signal)
      .then((res) => [name, res.data.map((item) => ({ value: item.id, label: item.code ? `${item.name} (${item.code})` : item.name }))])
      .catch(() => [name, []])))
      .then((entries) => { if (!controller.signal.aborted) setLookups(Object.fromEntries(entries)); });
    return () => controller.abort();
  }, [key, enabled]);

  return lookups;
}

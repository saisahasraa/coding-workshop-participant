import { useEffect, useState } from 'react';
import { departmentsApi, projectsApi, teamsApi, usersApi } from '../api/resources';

const ACTIVE = { is_active: true, limit: 200, sort: 'name' };

/** Active members of every team the signed-in user leads (plus nothing else). */
async function myTeamMembers(signal) {
  const teams = await teamsApi.list({ lead_id: 'me', limit: 100 }, signal);
  const lists = await Promise.all(teams.data.map((t) => usersApi.list({ ...ACTIVE, team_id: t.id }, signal)));
  const seen = new Map(lists.flatMap((l) => l.data).map((u) => [u.id, u]));
  return { data: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

/** `Engineering (ENG)` for departments, `WEB · Website relaunch` for projects, the name otherwise. */
const optionLabel = (item) => {
  if (item.code) return `${item.name} (${item.code})`;
  return item.key ? `${item.key} · ${item.name}` : item.name;
};

const LOADERS = {
  departments: (signal) => departmentsApi.list({ limit: 200, sort: 'name' }, signal),
  teams: (signal) => teamsApi.list({ limit: 200, sort: 'name' }, signal),
  leads: (signal) => usersApi.list({ ...ACTIVE, role: 'team_lead' }, signal),
  managers: (signal) => usersApi.list({ ...ACTIVE, role: 'project_manager,admin' }, signal),
  people: (signal) => usersApi.list(ACTIVE, signal),
  assignees: (signal) => usersApi.list({ ...ACTIVE, role: 'admin,project_manager,team_lead,team_member' }, signal),
  myTeam: myTeamMembers,
  // Projects that still take new work, which the caller may add deliverables to.
  openProjects: (signal) => projectsApi.list({ limit: 200, sort: 'key', status: 'planning,active,on_hold' }, signal)
    .then((res) => ({ data: res.data.filter((p) => p.permissions.add_deliverables) })),
};

/**
 * Load option lists (`{value: id, label}`) for form selects while `enabled`.
 * @param {Array<keyof typeof LOADERS>} names
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
      .then((res) => [name, res.data.map((item) => ({ value: item.id, label: optionLabel(item) }))])
      .catch(() => [name, []])))
      .then((entries) => { if (!controller.signal.aborted) setLookups(Object.fromEntries(entries)); });
    return () => controller.abort();
  }, [key, enabled]);

  return lookups;
}

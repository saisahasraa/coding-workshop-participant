import { useAuth } from '../../auth/AuthContext';
import useLookups from '../../hooks/useLookups';

/**
 * People the signed-in user may record leave for: everyone (admin), their team and themselves
 * (team lead), or only themselves (everyone else, for whom `people` is `null`).
 *
 * @param {boolean} enabled Load options (e.g. only while a dialog is open)
 * @returns {{people: ?{value: number, label: string}[]}}
 */
export default function useLeavePeople(enabled) {
  const { user } = useAuth();
  const source = user.role === 'admin' ? 'people' : 'myTeam';
  const lookups = useLookups([source], enabled && ['admin', 'team_lead'].includes(user.role));
  if (!['admin', 'team_lead'].includes(user.role)) return { people: null };
  const loaded = lookups[source] || [];
  const withSelf = loaded.some((p) => p.value === user.id) ? loaded : [{ value: user.id, label: `${user.name} (you)` }, ...loaded];
  return { people: withSelf };
}

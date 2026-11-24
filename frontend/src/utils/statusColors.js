/** Theme colour used for each status, priority, role and category value. */
export const STATUS_COLORS = {
  // project statuses
  planning: 'info', active: 'primary', on_hold: 'warning', completed: 'success', cancelled: 'default',
  // deliverable statuses
  not_started: 'default', in_progress: 'primary', blocked: 'error',
  // priorities
  low: 'default', medium: 'info', high: 'warning', critical: 'error',
  // roles
  admin: 'secondary', project_manager: 'primary', team_lead: 'info', team_member: 'default', viewer: 'default',
};

/** Whether the signed-in user may change this deliverable's status (from the record's own permissions). */
export const canSetStatus = (item) => Boolean(item.permissions?.update)
  && (item.permissions.editable_fields === null || item.permissions.editable_fields.includes('status'));

/**
 * Calendar days covered by a leave, inclusive of both ends.
 * @param {{start_date: string, end_date: string}} leave ISO dates
 * @returns {number}
 */
export default function leaveLength(leave) {
  return Math.round((new Date(leave.end_date) - new Date(leave.start_date)) / 86400000) + 1;
}

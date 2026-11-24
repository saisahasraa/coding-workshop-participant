/** Comments and linked work items on a deliverable (addressed by key, e.g. ENG-12, or id). */
import { api } from './client';

const base = (ref) => `/deliverables/${encodeURIComponent(ref)}`;

export const listComments = (ref, signal) => api.get(`${base(ref)}/comments`, { signal });
/** @param {number[]} [mentions] ids of the people @mentioned in the text */
export const addComment = (ref, body, mentions = []) => api.post(`${base(ref)}/comments`, { body, mentions });
export const updateComment = (id, body, mentions = []) => api.put(`/comments/${id}`, { body, mentions });
export const deleteComment = (id) => api.delete(`/comments/${id}`);

export const listLinks = (ref, signal) => api.get(`${base(ref)}/links`, { signal });
/** @param {'blocks'|'is_blocked_by'|'relates_to'} type */
export const addLink = (ref, type, target) => api.post(`${base(ref)}/links`, { type, target });
export const deleteLink = (ref, linkId) => api.delete(`${base(ref)}/links/${linkId}`);

// Attachments: the API hands out short-lived signed links; the bytes go straight to and from storage.
export const listAttachments = (ref, signal) => api.get(`${base(ref)}/attachments`, { signal });
export const deleteAttachment = (id) => api.delete(`/attachments/${id}`);
/** @returns {Promise<{url: string, filename: string}>} a link valid for a few minutes */
export const attachmentLink = (id, signal) => api.get(`/attachments/${id}/download`, { signal });

/**
 * Upload one file to a deliverable: reserve it, send the bytes to storage, and return its record.
 * A failed upload removes the reservation so no empty file is left listed.
 * @param {string} ref deliverable key or id
 * @param {File} file
 */
export async function uploadAttachment(ref, file) {
  const record = await api.post(`${base(ref)}/attachments`, {
    filename: file.name, content_type: file.type || 'application/octet-stream', size_bytes: file.size,
  });
  try {
    const res = await fetch(record.upload.url, { method: record.upload.method, headers: record.upload.headers, body: file });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  } catch (err) {
    await deleteAttachment(record.id).catch(() => {});
    throw err;
  }
  return record;
}

// Notifications
export const fetchNotifications = (signal) => api.get('/notifications', { signal });
/** @param {number[]} [ids] omit to mark everything read */
export const markNotificationsRead = (ids) => api.post('/notifications/read', ids ? { ids } : {});
/** Admins: try to send an email to yourself. @returns {Promise<{sent: boolean, error: ?string, to: string, from: ?string, enabled: boolean}>} */
export const sendTestEmail = () => api.post('/notifications/test-email', {});

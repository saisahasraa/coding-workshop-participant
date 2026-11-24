/** Comments and linked work items on a deliverable (addressed by key, e.g. ENG-12, or id). */
import { api } from './client';

const base = (ref) => `/deliverables/${encodeURIComponent(ref)}`;

export const listComments = (ref, signal) => api.get(`${base(ref)}/comments`, { signal });
export const addComment = (ref, body) => api.post(`${base(ref)}/comments`, { body });
export const updateComment = (id, body) => api.put(`/comments/${id}`, { body });
export const deleteComment = (id) => api.delete(`/comments/${id}`);

export const listLinks = (ref, signal) => api.get(`${base(ref)}/links`, { signal });
/** @param {'blocks'|'is_blocked_by'|'relates_to'} type */
export const addLink = (ref, type, target) => api.post(`${base(ref)}/links`, { type, target });
export const deleteLink = (ref, linkId) => api.delete(`${base(ref)}/links/${linkId}`);

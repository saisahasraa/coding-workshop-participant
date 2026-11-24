/** Authentication endpoints. */
import { api } from './client';

/** @returns {Promise<{access_token: string, refresh_token: string, user: object}>} */
export const login = (email, password) => api.post('/auth/login', { email, password });

/** @returns {Promise<{user: object, permissions: Object<string, string[]>}>} */
export const fetchMe = (signal) => api.get('/auth/me', { signal });

/** Change own name and/or password. */
export const updateMe = (changes) => api.put('/auth/me', changes);

/** Revoke every session of the current user. */
export const logoutAll = () => api.post('/auth/logout-all');

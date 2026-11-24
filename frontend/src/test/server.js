/** Shared MSW server; tests register per-case handlers with `server.use(...)`. */
import { setupServer } from 'msw/node';
import { API_BASE_URL } from '../config';

export const server = setupServer();

/** Absolute URL for an API path, exactly as the client requests it. */
export const apiUrl = (path) => new URL(`${API_BASE_URL}${path}`, window.location.origin).toString();

/**
 * Thin fetch wrapper for the REST API.
 *
 * Every failure is normalized into an `ApiError` with a stable `code`, so UI code never has
 * to inspect raw responses: server errors use the backend envelope
 * `{error: {code, message, details, request_id}}`; transport problems become
 * `network_error` or `timeout`. Caller-initiated aborts propagate as the native AbortError.
 */

import { API_BASE_URL, REQUEST_TIMEOUT_MS } from '../config';

/** Error thrown for any unsuccessful API call. */
export class ApiError extends Error {
  /**
   * @param {object} init
   * @param {number} init.status HTTP status (0 when the server was not reached)
   * @param {string} init.code Machine-readable error code
   * @param {string} init.message Human-readable message, safe to show to users
   * @param {object} [init.details] Field -> message map for validation errors
   * @param {string} [init.requestId] Backend request id for log correlation
   * @param {*} [init.body] Parsed response body, if any
   */
  constructor({ status, code, message, details, requestId, body }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.body = body;
  }
}

const DEFAULT_MESSAGES = {
  400: 'The request was not valid.',
  401: 'Please sign in to continue.',
  403: 'You do not have permission to do that.',
  404: 'The requested item was not found.',
  409: 'This conflicts with existing data.',
  503: 'The service is temporarily unavailable. Please try again.',
};

/**
 * Build an absolute request URL, skipping empty query values.
 * @param {string} path Path relative to the API base, e.g. `/projects`
 * @param {object} [query] Query parameters
 * @returns {string}
 */
export function buildUrl(path, query) {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  });
  return url.toString();
}

async function parseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Perform an API request and return the parsed JSON body (`null` for 204).
 * @param {string} path Path relative to the API base
 * @param {object} [options]
 * @param {string} [options.method='GET']
 * @param {object} [options.query] Query parameters
 * @param {*} [options.body] JSON-serializable request body
 * @param {AbortSignal} [options.signal] Cancels the request (e.g. on unmount)
 * @param {number} [options.timeoutMs] Overrides the default timeout
 * @returns {Promise<*>}
 * @throws {ApiError}
 */
export async function apiRequest(path, {
  method = 'GET', query, body, signal, timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort);

  let response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new ApiError({ status: 0, code: 'timeout', message: 'The server took too long to respond.' });
    }
    if (signal?.aborted) throw error;
    throw new ApiError({ status: 0, code: 'network_error', message: 'Cannot reach the server. Check your connection.' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }

  const requestId = response.headers.get('x-request-id') || undefined;
  const data = response.status === 204 ? null : await parseJson(response);
  if (!response.ok) {
    const envelope = data?.error || {};
    throw new ApiError({
      status: response.status,
      code: envelope.code || 'http_error',
      message: envelope.message || DEFAULT_MESSAGES[response.status] || 'Something went wrong. Please try again.',
      details: envelope.details,
      requestId: envelope.request_id || requestId,
      body: data,
    });
  }
  return data;
}

/** Convenience verbs. */
export const api = {
  get: (path, options) => apiRequest(path, { ...options, method: 'GET' }),
  post: (path, body, options) => apiRequest(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => apiRequest(path, { ...options, method: 'PUT', body }),
  delete: (path, options) => apiRequest(path, { ...options, method: 'DELETE' }),
};

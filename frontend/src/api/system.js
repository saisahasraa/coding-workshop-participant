/** System endpoints. */

import { api, ApiError } from './client';

/**
 * Fetch backend health. A 503 still carries a health body (database unavailable), so it is
 * returned as data rather than thrown.
 * @param {AbortSignal} [signal]
 * @returns {Promise<{status: string, database: string, schema_version: ?number,
 *   schema_latest: number, environment: string, version: string}>}
 */
export async function getHealth(signal) {
  try {
    return await api.get('/health', { signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 503 && error.body?.database) {
      return error.body;
    }
    throw error;
  }
}

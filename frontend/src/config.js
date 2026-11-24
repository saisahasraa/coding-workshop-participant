/**
 * Build-time configuration (Vite env). Everything tunable at runtime comes from the
 * backend (`GET /meta`, Phase 1) so admins can change it without a rebuild.
 */

const apiOrigin = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

/** Base URL of the REST API; empty origin means same origin (CloudFront). */
export const API_BASE_URL = `${apiOrigin}/api/v1`;

/** Abort API calls that take longer than this (milliseconds). */
export const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_REQUEST_TIMEOUT_MS) || 15000;

/** Fallback application name until runtime settings are loaded. */
export const DEFAULT_APP_NAME = 'ACME Project Tracker';

/** localStorage key remembering the colour mode (light, dark or system). */
export const COLOR_MODE_KEY = 'acme.colorMode';

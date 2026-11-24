/**
 * Token storage. The short-lived access token stays in memory only; the refresh token is
 * kept in localStorage so a reload keeps the session (documented trade-off in the plan).
 */

const REFRESH_KEY = 'acme.refreshToken';
let accessToken = null;

/** @returns {?string} */
export function getAccessToken() {
  return accessToken;
}

/** @returns {?string} */
export function getRefreshToken() {
  try {
    return window.localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

/**
 * Store a token pair returned by login/refresh.
 * @param {{access_token: string, refresh_token: string}} tokens
 */
export function setTokens(tokens) {
  accessToken = tokens.access_token;
  try {
    window.localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
  } catch {
    // Storage unavailable (private mode): the session simply will not survive a reload.
  }
}

/** Forget both tokens. */
export function clearTokens() {
  accessToken = null;
  try {
    window.localStorage.removeItem(REFRESH_KEY);
  } catch {
    // ignore
  }
}

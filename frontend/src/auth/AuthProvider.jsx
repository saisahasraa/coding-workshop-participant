import { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { fetchMe, login as loginRequest, logoutAll as logoutAllRequest } from '../api/auth';
import { refreshSession, setSessionEndedHandler } from '../api/client';
import { AuthContext } from './AuthContext';
import { clearTokens, getRefreshToken, setTokens } from './tokenStore';

const ANONYMOUS = { status: 'anonymous', user: null, permissions: {} };

/** Provides the signed-in user, their role capabilities, and sign-in/out actions. */
export default function AuthProvider({ children }) {
  const [session, setSession] = useState(() => (getRefreshToken() ? { ...ANONYMOUS, status: 'loading' } : ANONYMOUS));

  const loadMe = useCallback(async () => {
    const me = await fetchMe();
    setSession({ status: 'authenticated', user: me.user, permissions: me.permissions });
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    setSession(ANONYMOUS);
  }, []);

  // Resume a stored session on first load.
  useEffect(() => {
    if (!getRefreshToken()) return undefined;
    let cancelled = false;
    refreshSession()
      .then((ok) => (ok ? fetchMe() : null))
      .then((me) => {
        if (cancelled) return;
        setSession(me ? { status: 'authenticated', user: me.user, permissions: me.permissions } : ANONYMOUS);
      })
      .catch(() => { if (!cancelled) logout(); });
    return () => { cancelled = true; };
  }, [logout]);

  useEffect(() => {
    setSessionEndedHandler(logout);
    return () => setSessionEndedHandler(() => {});
  }, [logout]);

  const login = useCallback(async (email, password) => {
    const result = await loginRequest(email, password);
    setTokens(result);
    await loadMe();
  }, [loadMe]);

  const logoutAll = useCallback(async () => {
    try {
      await logoutAllRequest();
    } finally {
      logout();
    }
  }, [logout]);

  const can = useCallback(
    (resource, action) => (session.permissions[resource] || []).includes(action),
    [session.permissions],
  );

  const value = useMemo(() => ({
    ...session, login, logout, logoutAll, reload: loadMe, can,
  }), [session, login, logout, logoutAll, loadMe, can]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

AuthProvider.propTypes = {
  children: PropTypes.node,
};

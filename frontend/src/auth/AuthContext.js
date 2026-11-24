import { createContext, useContext } from 'react';

/** @type {import('react').Context<?object>} */
export const AuthContext = createContext(null);

/**
 * Current session: `{status, user, permissions, login, logout, logoutAll, reload, can}`.
 * `status` is `loading`, `authenticated` or `anonymous`.
 */
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

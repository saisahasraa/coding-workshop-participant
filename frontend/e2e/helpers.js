/** Shared helpers: demo accounts, API access for set-up and clean-up, and signing in without the form. */
import { expect } from '@playwright/test';

export const API = process.env.E2E_API_URL || 'http://localhost:3001/api/v1';
export const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD || 'Demo#2026!';
export const USERS = {
  manager: 'alice.pm@acme.example',
  member: 'dan.dev@acme.example',
  viewer: 'grace.exec@acme.example',
  admin: process.env.E2E_ADMIN_EMAIL || 'admin@acme.example',
};
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || '';

/** Sign in through the API and return both tokens. */
export async function tokensFor(request, email, password = DEMO_PASSWORD) {
  const res = await request.post(`${API}/auth/login`, { data: { email, password } });
  expect(res.ok(), `sign-in as ${email}`).toBeTruthy();
  return res.json();
}

/** A tiny API client acting as `email`, for arranging and removing test data. */
export async function apiAs(request, email, password = DEMO_PASSWORD) {
  const { access_token: token } = await tokensFor(request, email, password);
  const headers = { Authorization: `Bearer ${token}` };
  const call = (method) => async (path, data) => {
    const res = await request[method](`${API}${path}`, { headers, data });
    return { status: res.status(), body: res.status() === 204 ? null : await res.json().catch(() => null) };
  };
  return { get: call('get'), post: call('post'), put: call('put'), delete: call('delete') };
}

/** Open the app already signed in as `email` (the refresh token is placed where a real sign-in leaves it). */
export async function signIn(page, request, email, password = DEMO_PASSWORD) {
  const { refresh_token: refreshToken } = await tokensFor(request, email, password);
  await page.addInitScript((token) => {
    if (!window.localStorage.getItem('acme.refreshToken')) window.localStorage.setItem('acme.refreshToken', token);
  }, refreshToken);
}

/** Remove a project left behind by an earlier, interrupted run. */
export async function dropProject(api, key) {
  const found = await api.get(`/projects/${key}`);
  if (found.status === 200) await api.delete(`/projects/${found.body.id}`);
}

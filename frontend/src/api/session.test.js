import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { api, setSessionEndedHandler } from './client';
import { getAccessToken, setTokens } from '../auth/tokenStore';
import { apiUrl, server } from '../test/server';

const expired = () => HttpResponse.json({ error: { code: 'token_expired', message: 'expired' } }, { status: 401 });

describe('session handling in the API client', () => {
  it('sends the bearer token and transparently refreshes an expired one once', async () => {
    setTokens({ access_token: 'old', refresh_token: 'r1' });
    let refreshCalls = 0;
    server.use(
      http.get(apiUrl('/things'), ({ request }) => (request.headers.get('authorization') === 'Bearer new'
        ? HttpResponse.json({ ok: true }) : expired())),
      http.post(apiUrl('/auth/refresh'), async ({ request }) => {
        refreshCalls += 1;
        expect(await request.json()).toEqual({ refresh_token: 'r1' });
        return HttpResponse.json({ access_token: 'new', refresh_token: 'r2' });
      }),
    );
    const [a, b] = await Promise.all([api.get('/things'), api.get('/things')]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(refreshCalls).toBe(1); // concurrent 401s share one refresh
    expect(getAccessToken()).toBe('new');
    expect(window.localStorage.getItem('acme.refreshToken')).toBe('r2');
  });

  it('ends the session when refreshing fails', async () => {
    setTokens({ access_token: 'old', refresh_token: 'r1' });
    const ended = vi.fn();
    setSessionEndedHandler(ended);
    server.use(
      http.get(apiUrl('/things'), expired),
      http.post(apiUrl('/auth/refresh'), () => HttpResponse.json({ error: { code: 'invalid_token' } }, { status: 401 })),
    );
    await expect(api.get('/things')).rejects.toMatchObject({ status: 401 });
    expect(ended).toHaveBeenCalledOnce();
    expect(getAccessToken()).toBeNull();
    setSessionEndedHandler(() => {});
  });

  it('does not refresh for forbidden responses or without a refresh token', async () => {
    server.use(http.get(apiUrl('/things'), () => HttpResponse.json({ error: { code: 'forbidden', message: 'no' } }, { status: 403 })));
    await expect(api.get('/things')).rejects.toMatchObject({ status: 403 });
    server.use(http.get(apiUrl('/things'), expired));
    await expect(api.get('/things')).rejects.toMatchObject({ code: 'token_expired' });
  });
});

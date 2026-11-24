import { describe, expect, it } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { api, apiRequest, ApiError, buildUrl } from './client';
import { apiUrl, server } from '../test/server';

describe('buildUrl', () => {
  it('joins the API base and skips empty query values', () => {
    const url = new URL(buildUrl('/projects', { q: 'web', status: ['active', 'on_hold'], empty: '', none: null }));
    expect(url.pathname).toBe('/api/v1/projects');
    expect(url.searchParams.get('q')).toBe('web');
    expect(url.searchParams.get('status')).toBe('active,on_hold');
    expect(url.searchParams.has('empty')).toBe(false);
    expect(url.searchParams.has('none')).toBe(false);
  });
});

describe('apiRequest', () => {
  it('returns parsed JSON and sends JSON bodies', async () => {
    server.use(http.post(apiUrl('/echo'), async ({ request }) => HttpResponse.json({
      got: await request.json(), type: request.headers.get('content-type'),
    })));
    await expect(api.post('/echo', { a: 1 })).resolves.toEqual({ got: { a: 1 }, type: 'application/json' });
  });

  it('returns null for 204 responses', async () => {
    server.use(http.delete(apiUrl('/items/1'), () => new HttpResponse(null, { status: 204 })));
    await expect(api.delete('/items/1')).resolves.toBeNull();
  });

  it('supports PUT and GET helpers', async () => {
    server.use(
      http.put(apiUrl('/items/1'), () => HttpResponse.json({ ok: true })),
      http.get(apiUrl('/items'), () => HttpResponse.json([])),
    );
    await expect(api.put('/items/1', { name: 'x' })).resolves.toEqual({ ok: true });
    await expect(api.get('/items')).resolves.toEqual([]);
  });

  it('maps the backend error envelope to ApiError', async () => {
    server.use(http.post(apiUrl('/items'), () => HttpResponse.json(
      { error: { code: 'validation_error', message: 'Request validation failed', details: { name: 'is required' }, request_id: 'r-1' } },
      { status: 400 },
    )));
    const error = await api.post('/items', {}).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'validation_error', details: { name: 'is required' }, requestId: 'r-1' });
  });

  it('falls back to a friendly message for non-JSON errors', async () => {
    server.use(http.get(apiUrl('/broken'), () => new HttpResponse('Internal Server Error', {
      status: 503, headers: { 'X-Request-Id': 'r-2' },
    })));
    const error = await api.get('/broken').catch((e) => e);
    expect(error).toMatchObject({ status: 503, code: 'http_error', requestId: 'r-2' });
    expect(error.message).toMatch(/temporarily unavailable/);
  });

  it('uses a generic message for unknown statuses', async () => {
    server.use(http.get(apiUrl('/teapot'), () => new HttpResponse(null, { status: 418 })));
    await expect(api.get('/teapot')).rejects.toThrow('Something went wrong');
  });

  it('reports network errors', async () => {
    server.use(http.get(apiUrl('/down'), () => HttpResponse.error()));
    await expect(api.get('/down')).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });

  it('times out slow requests', async () => {
    server.use(http.get(apiUrl('/slow'), async () => { await delay('infinite'); }));
    await expect(apiRequest('/slow', { timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('propagates caller aborts as AbortError', async () => {
    server.use(http.get(apiUrl('/slow'), async () => { await delay('infinite'); }));
    const controller = new AbortController();
    const pending = api.get('/slow', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toHaveProperty('name', 'AbortError');
  });
});

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import StatusPage from './StatusPage';
import { renderWithProviders } from '../../test/render';
import { apiUrl, server } from '../../test/server';

const healthy = {
  status: 'ok', database: 'ok', schema_version: 1, schema_latest: 1, environment: 'local', version: '0.1.0',
};

describe('StatusPage', () => {
  it('shows a healthy system', async () => {
    server.use(http.get(apiUrl('/health'), () => HttpResponse.json(healthy)));
    renderWithProviders(<StatusPage />);
    expect(await screen.findByText('Online')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('v1 of 1')).toBeInTheDocument();
    expect(screen.getByText('local · v0.1.0')).toBeInTheDocument();
  });

  it('shows a degraded database from a 503 health body', async () => {
    server.use(http.get(apiUrl('/health'), () => HttpResponse.json(
      { ...healthy, status: 'degraded', database: 'unavailable', schema_version: null },
      { status: 503 },
    )));
    renderWithProviders(<StatusPage />);
    expect(await screen.findByText('Degraded')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('shows an error when the API is unreachable, and recovers on refresh', async () => {
    server.use(http.get(apiUrl('/health'), () => HttpResponse.error(), { once: true }));
    renderWithProviders(<StatusPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server');

    server.use(http.get(apiUrl('/health'), () => HttpResponse.json(healthy)));
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(await screen.findByText('Online')).toBeInTheDocument();
  });

  it('includes the request id of server errors', async () => {
    server.use(http.get(apiUrl('/health'), () => HttpResponse.json(
      { error: { code: 'internal_error', message: 'Internal server error', request_id: 'abc-123' } },
      { status: 500 },
    )));
    renderWithProviders(<StatusPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('request abc-123');
  });
});

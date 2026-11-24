import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import App from './App';
import { renderWithProviders } from './test/render';
import { apiUrl, server } from './test/server';

describe('App shell and routing', () => {
  it('renders the app name, navigation and the status page on desktop', async () => {
    server.use(http.get(apiUrl('/health'), () => HttpResponse.json({ status: 'ok', database: 'ok', schema_version: 1, schema_latest: 1, environment: 'local', version: '0.1.0' })));
    renderWithProviders(<App />);
    expect(screen.getByText('ACME Project Tracker')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'System status' })).toHaveClass('active');
    expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'System status' })).toBeInTheDocument();
  });

  it('shows a not-found page for unknown routes', async () => {
    renderWithProviders(<App />, { route: '/does-not-exist' });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('uses a toggleable drawer on mobile', async () => {
    server.use(http.get(apiUrl('/health'), () => HttpResponse.json({ status: 'ok', database: 'ok', schema_version: 1, schema_latest: 1, environment: 'local', version: '0.1.0' })));
    renderWithProviders(<App />, { width: 375 });
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const link = await screen.findByRole('link', { name: 'System status' });
    await userEvent.click(link);
    expect(await screen.findByRole('heading', { name: 'System status' })).toBeInTheDocument();
  });
});

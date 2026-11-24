import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import App from './App';
import { page, PERMISSIONS, PROJECT, sessionHandlers, SUMMARY, userFor } from './test/fixtures';
import { renderWithApp } from './test/render';
import { apiUrl, server } from './test/server';

const projects = () => http.get(apiUrl('/projects'), () => HttpResponse.json(page([PROJECT])));
const summary = () => http.get(apiUrl('/reports/summary'), () => HttpResponse.json(SUMMARY));

describe('App routing and navigation', () => {
  it('sends anonymous visitors to the login page and back after signing in', async () => {
    server.use(
      http.post(apiUrl('/auth/login'), async ({ request }) => {
        const { password } = await request.json();
        return password === 'right-pass'
          ? HttpResponse.json({ access_token: 'a', refresh_token: 'r', user: userFor('viewer') })
          : HttpResponse.json({ error: { code: 'invalid_credentials', message: 'Invalid email or password' } }, { status: 401 });
      }),
      http.get(apiUrl('/auth/me'), () => HttpResponse.json({ user: userFor('viewer'), permissions: PERMISSIONS.viewer })),
      http.get(apiUrl('/meta'), () => HttpResponse.json({ settings: {} })),
      projects(),
    );
    renderWithApp(<App />, { guard: false, route: '/projects', signedIn: false });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/email/i), 'viewer@acme.example');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText(/password/i));
    await userEvent.type(screen.getByLabelText(/password/i), 'right-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(await screen.findByText('Website relaunch')).toBeInTheDocument();
  });

  it('shows admin navigation and the runtime app name', async () => {
    server.use(...sessionHandlers('admin'), projects(), summary());
    renderWithApp(<App />, { guard: false, route: '/projects' });
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    for (const label of ['Dashboard', 'Projects', 'My work', 'Users', 'Departments', 'Settings', 'Audit log', 'System status']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(await screen.findByText('ACME Test Tracker')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'New project' })).toBeInTheDocument();
  });

  it('hides actions and admin pages from viewers', async () => {
    server.use(...sessionHandlers('viewer'), projects(), summary());
    renderWithApp(<App />, { guard: false, route: '/admin/users' });
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument(); // redirected home
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'My work' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument();
  });

  it('signs out from the account menu', async () => {
    server.use(...sessionHandlers('team_member'), projects(), summary());
    renderWithApp(<App />, { guard: false });
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(window.localStorage.getItem('acme.refreshToken')).toBeNull();
  });

  it('collapses the navigation to an icon rail and remembers the choice', async () => {
    server.use(...sessionHandlers('admin'), projects(), summary());
    const { unmount } = renderWithApp(<App />, { guard: false });
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByText('Projects')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(within(nav).queryByText('Projects')).not.toBeInTheDocument(); // labels hidden, icons stay
    expect(within(nav).getByRole('link', { name: 'Projects' })).toBeInTheDocument(); // still reachable by name
    expect(window.localStorage.getItem('acme.navCollapsed')).toBe('true');
    unmount();

    renderWithApp(<App />, { guard: false, keepStorage: true });
    expect(await screen.findByRole('button', { name: 'Expand navigation' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Expand navigation' }));
    expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByText('Projects')).toBeInTheDocument();
  });

  it('switches between light and dark mode and remembers it', async () => {
    server.use(...sessionHandlers('viewer'), projects(), summary());
    renderWithApp(<App />, { guard: false });
    await userEvent.click(await screen.findByRole('button', { name: 'Switch to dark mode' }));
    expect(await screen.findByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement).toHaveClass('light');
  });

  it('groups the navigation into sections', async () => {
    server.use(...sessionHandlers('admin'), projects(), summary());
    renderWithApp(<App />, { guard: false });
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    for (const section of ['Overview', 'Work', 'People', 'Money', 'Admin', 'System']) expect(within(nav).getByText(section)).toBeInTheDocument();
  });

  it('shows a not-found page for unknown routes', async () => {
    server.use(...sessionHandlers('viewer'));
    renderWithApp(<App />, { guard: false, route: '/does-not-exist' });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('uses a toggleable drawer on mobile', async () => {
    server.use(...sessionHandlers('viewer'), projects(), summary());
    renderWithApp(<App />, { guard: false, width: 375 });
    await userEvent.click(await screen.findByRole('button', { name: 'Open navigation' }));
    await userEvent.click(await screen.findByRole('link', { name: 'System status' }));
    server.use(http.get(apiUrl('/health'), () => HttpResponse.json({ status: 'ok', database: 'ok', schema_version: 2, schema_latest: 2, environment: 'local', version: '0.1.0' })));
    expect(await screen.findByRole('heading', { name: 'System status' })).toBeInTheDocument();
  });

  it('returns to login when the stored session cannot be resumed', async () => {
    server.use(http.post(apiUrl('/auth/refresh'), () => HttpResponse.json({ error: { code: 'invalid_token', message: 'x' } }, { status: 401 })));
    renderWithApp(<App />, { guard: false, route: '/projects' });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});

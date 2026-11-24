import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import DepartmentsPage from './DepartmentsPage';
import UsersPage from './UsersPage';
import { page, sessionHandlers, userFor } from '../../test/fixtures';
import { renderWithApp } from '../../test/render';
import { apiUrl, server } from '../../test/server';

const withPerms = (user) => ({ ...user, last_login_at: null, permissions: { update: true, delete: true, editable_fields: null } });

describe('Users admin', () => {
  it('creates a user', async () => {
    let created;
    server.use(
      ...sessionHandlers('admin'),
      http.get(apiUrl('/users'), () => HttpResponse.json(page([withPerms(userFor('viewer', 5))]))),
      http.post(apiUrl('/users'), async ({ request }) => { created = await request.json(); return HttpResponse.json({ id: 9 }, { status: 201 }); }),
    );
    renderWithApp(<UsersPage />, { route: '/admin/users' });
    expect(await screen.findByText('viewer@acme.example')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New user' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/full name/i), 'New Person');
    await userEvent.type(within(dialog).getByLabelText(/^email/i), 'new@acme.example');
    await userEvent.type(within(dialog).getByLabelText(/^password/i), 'Welcome#123');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(created).toMatchObject({
      name: 'New Person', email: 'new@acme.example', role: 'team_member', password: 'Welcome#123', weekly_capacity_hours: 40,
    }));
    expect(await screen.findByText('User created')).toBeInTheDocument();
  });

  it('does not offer deleting yourself, and deletes others', async () => {
    let deleted = false;
    server.use(
      ...sessionHandlers('admin'),
      http.get(apiUrl('/users'), () => HttpResponse.json(page([withPerms(userFor('admin', 1)), withPerms(userFor('viewer', 5))]))),
      http.delete(apiUrl('/users/5'), () => { deleted = true; return new HttpResponse(null, { status: 204 }); }),
    );
    renderWithApp(<UsersPage />, { route: '/admin/users' });
    expect(await screen.findByText('viewer@acme.example')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Ada admin' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete Pat viewer' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleted).toBe(true));
  });
});

describe('Departments admin', () => {
  it('shows a conflict when deleting a department in use', async () => {
    server.use(
      ...sessionHandlers('admin'),
      http.get(apiUrl('/departments'), () => HttpResponse.json(page([{ id: 1, name: 'Marketing', code: 'MKT', description: null, project_count: 2 }]))),
      http.delete(apiUrl('/departments/1'), () => HttpResponse.json({ error: { code: 'conflict', message: 'The record is referenced by, or references, another record' } }, { status: 409 })),
    );
    renderWithApp(<DepartmentsPage />, { route: '/admin/departments' });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Marketing' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/referenced by/)).toBeInTheDocument();
  });

  it('creates a department', async () => {
    let created;
    server.use(
      ...sessionHandlers('admin'),
      http.get(apiUrl('/departments'), () => HttpResponse.json(page([]))),
      http.post(apiUrl('/departments'), async ({ request }) => { created = await request.json(); return HttpResponse.json({ id: 3 }, { status: 201 }); }),
    );
    renderWithApp(<DepartmentsPage />, { route: '/admin/departments' });
    await userEvent.click(await screen.findByRole('button', { name: 'New department' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'Finance');
    await userEvent.type(within(dialog).getByLabelText(/^code/i), 'FIN');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(created).toEqual({ name: 'Finance', code: 'FIN', description: null }));
  });
});

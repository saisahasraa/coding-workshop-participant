import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import AuditLogPage from './AuditLogPage';
import SettingsPage from './SettingsPage';
import { AUDIT, page, SETTINGS, sessionHandlers } from '../../test/fixtures';
import { renderWithApp } from '../../test/render';
import { apiUrl, server } from '../../test/server';

const listing = (body = SETTINGS) => http.get(apiUrl('/settings'), () => HttpResponse.json(body));
const fail = (message) => HttpResponse.json({ error: { code: 'internal_error', message } }, { status: 500 });

describe('Settings console', () => {
  it('groups settings, showing defaults, customizations and who changed them', async () => {
    server.use(...sessionHandlers('admin'), listing());
    renderWithApp(<SettingsPage />);
    expect(await screen.findByRole('heading', { name: 'Project health' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Logging' })).toBeInTheDocument();
    expect(screen.getByText('Default: 10')).toBeInTheDocument();
    expect(screen.getByText('Customized')).toBeInTheDocument();
    expect(screen.getByText(/Changed by Ada admin/)).toBeInTheDocument();
  });

  it('saves a changed number, and only when something changed', async () => {
    const saved = [];
    server.use(...sessionHandlers('admin'), listing(), http.put(apiUrl('/settings/health.amber_schedule_gap_pct'), async ({ request }) => {
      saved.push(await request.json());
      return HttpResponse.json({ ...SETTINGS.data[0], value: 20, overridden: true });
    }));
    renderWithApp(<SettingsPage />);
    const field = await screen.findByLabelText('health.amber_schedule_gap_pct');
    const row = field.closest('.MuiStack-root').parentElement.parentElement;
    const save = within(row).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, '20');
    await userEvent.click(save);
    await waitFor(() => expect(saved).toEqual([{ value: 20 }]));
    expect(await screen.findByText('health.amber_schedule_gap_pct saved')).toBeInTheDocument();
  });

  it('shows the server\'s validation message under the field', async () => {
    server.use(...sessionHandlers('admin'), listing(), http.put(apiUrl('/settings/health.amber_schedule_gap_pct'), () => HttpResponse.json(
      { error: { code: 'validation_error', message: 'Request validation failed', details: { value: 'must be at most 100' } } }, { status: 400 })));
    renderWithApp(<SettingsPage />);
    const field = await screen.findByLabelText('health.amber_schedule_gap_pct');
    await userEvent.clear(field);
    await userEvent.type(field, '500');
    await userEvent.click(within(field.closest('.MuiStack-root').parentElement.parentElement).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('must be at most 100')).toBeInTheDocument();
  });

  it('edits lists and choices, and resets a customized setting', async () => {
    const calls = [];
    server.use(...sessionHandlers('admin'), listing(),
      http.put(apiUrl('/settings/leaves.types'), async ({ request }) => { calls.push(['PUT', await request.json()]); return HttpResponse.json(SETTINGS.data[2]); }),
      http.delete(apiUrl('/settings/logging.level'), () => { calls.push(['DELETE']); return new HttpResponse(null, { status: 204 }); }));
    renderWithApp(<SettingsPage />);
    const types = await screen.findByLabelText('leaves.types');
    await userEvent.type(types, ', training');
    await userEvent.click(within(types.closest('.MuiStack-root').parentElement.parentElement).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls[0]).toEqual(['PUT', { value: ['vacation', 'sick', 'training'] }]));

    expect(screen.getByLabelText('logging.level')).toHaveTextContent('DEBUG');
    expect(screen.getByLabelText('auth.enabled')).toBeChecked();
    expect(screen.getByLabelText('capacity.working_days')).toHaveValue('1, 2, 3, 4, 5');
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => expect(calls[1]).toEqual(['DELETE']));
  });

  it('shows the history of a setting', async () => {
    const queries = [];
    server.use(...sessionHandlers('admin'), listing(), http.get(apiUrl('/audit-log'), ({ request }) => {
      queries.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(page([AUDIT.data[0]]));
    }));
    renderWithApp(<SettingsPage />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'History' }))[1]);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Ada admin/)).toBeInTheDocument();
    expect(within(dialog).getByText('"DEBUG"')).toBeInTheDocument();
    expect(queries[0]).toMatchObject({ entity: 'app_settings' });
  });

  it('tests email delivery and explains the result', async () => {
    let answer = { sent: false, error: 'AccessDenied: not authorized to perform ses:SendEmail', to: 'ada@acme.example', from: 'tracker@acme.example', enabled: false };
    server.use(...sessionHandlers('admin'), listing(), http.post(apiUrl('/notifications/test-email'), () => HttpResponse.json(answer)));
    renderWithApp(<SettingsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send test email' }));
    expect(await screen.findByText(/Not sent. AccessDenied: not authorized to perform ses:SendEmail/)).toBeInTheDocument();
    answer = { ...answer, sent: true, error: null };
    await userEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(await screen.findByText(/Sent to ada@acme.example from tracker@acme.example. Turn on notifications.email_enabled/)).toBeInTheDocument();
    server.use(http.post(apiUrl('/notifications/test-email'), () => fail('Boom')));
    await userEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(await screen.findByText('Not sent. Boom')).toBeInTheDocument();
  });

  it('reports a failing settings load', async () => {
    server.use(...sessionHandlers('admin'), http.get(apiUrl('/settings'), () => fail('Boom')));
    renderWithApp(<SettingsPage />);
    expect(await screen.findByText('Boom')).toBeInTheDocument();
  });
});

describe('Audit log', () => {
  it('lists entries and filters them', async () => {
    const queries = [];
    server.use(...sessionHandlers('admin'), http.get(apiUrl('/audit-log'), ({ request }) => {
      queries.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(AUDIT);
    }));
    renderWithApp(<AuditLogPage />);
    expect(await screen.findByText('Ada admin')).toBeInTheDocument();
    expect(screen.getByText('Alice Morgan')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(queries[0]).toMatchObject({ sort: '-created_at', limit: '25' });

    await userEvent.click(screen.getByLabelText('Action'));
    await userEvent.click(await screen.findByRole('option', { name: 'Delete' }));
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ action: 'delete' }));
    await userEvent.click(screen.getByLabelText('Entity'));
    await userEvent.click(await screen.findByRole('option', { name: 'projects' }));
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ entity: 'projects', action: 'delete' }));
  });

  it('opens an entry to show what changed', async () => {
    server.use(...sessionHandlers('admin'), http.get(apiUrl('/audit-log'), () => HttpResponse.json(AUDIT)));
    renderWithApp(<AuditLogPage />);
    await userEvent.click(await screen.findByText('logging.level'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('"INFO" → "DEBUG"')).toBeInTheDocument();
    expect(within(dialog).getByText(/request req-3/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByText('7'));
    expect(await within(await screen.findByRole('dialog')).findByText('"Website relaunch"')).toBeInTheDocument();
  });

  it('reports failures and empty results', async () => {
    server.use(...sessionHandlers('admin'), http.get(apiUrl('/audit-log'), () => HttpResponse.json(page([]))));
    const { unmount } = renderWithApp(<AuditLogPage />);
    expect(await screen.findByText('No entries match these filters.')).toBeInTheDocument();
    unmount();
    server.use(http.get(apiUrl('/audit-log'), () => fail('Boom')));
    renderWithApp(<AuditLogPage />);
    expect(await screen.findByText('Boom')).toBeInTheDocument();
  });
});

import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import TeamDetailPage from './TeamDetailPage';
import TeamsPage from './TeamsPage';
import { CAPACITY, LEAVE, MEMBER, page, sessionHandlers, TEAM } from '../../test/fixtures';
import { renderWithApp } from '../../test/render';
import { apiUrl, server } from '../../test/server';

const adminTeam = { ...TEAM, permissions: { update: true, delete: true, editable_fields: null } };

function routes() {
  return (
    <Routes>
      <Route path="/teams" element={<TeamsPage />} />
      <Route path="/teams/:id" element={<TeamDetailPage />} />
    </Routes>
  );
}

describe('Teams list', () => {
  it('lets admins create a team and open it', async () => {
    let body;
    server.use(
      ...sessionHandlers('admin'),
      http.get(apiUrl('/teams'), () => HttpResponse.json(page([adminTeam]))),
      http.get(apiUrl('/departments'), () => HttpResponse.json(page([{ id: 1, name: 'Engineering', code: 'ENG' }]))),
      http.get(apiUrl('/users'), ({ request }) => HttpResponse.json(
        page(new URL(request.url).searchParams.has('team_id') ? [] : [{ id: 1, name: 'Pat team lead' }]),
      )),
      http.post(apiUrl('/teams'), async ({ request }) => { body = await request.json(); return HttpResponse.json({ ...adminTeam, ...body }, { status: 201 }); }),
      http.get(apiUrl('/teams/3'), () => HttpResponse.json(adminTeam)),
      http.get(apiUrl('/reports/capacity'), () => HttpResponse.json({ ...CAPACITY, data: [] })),
      http.get(apiUrl('/leaves'), () => HttpResponse.json(page([]))),
    );
    renderWithApp(routes(), { route: '/teams' });
    expect(await screen.findByText('Platform')).toBeInTheDocument();
    expect(screen.getByText('Pat team lead')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New team' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/team name/i), 'Data');
    await userEvent.click(within(dialog).getByLabelText(/department/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Engineering (ENG)' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(body).toEqual({ name: 'Data', department_id: 1, lead_id: null }));

    await userEvent.click(screen.getByText('Platform'));
    expect(await screen.findByRole('heading', { name: 'Platform' })).toBeInTheDocument();
  });

  it('is read-only for everyone else', async () => {
    server.use(...sessionHandlers('team_member'), http.get(apiUrl('/teams'), () => HttpResponse.json(page([TEAM]))));
    renderWithApp(routes(), { route: '/teams' });
    expect(await screen.findByText('Platform')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New team' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Platform' })).not.toBeInTheDocument();
  });
});

describe('Team page', () => {
  const memberHandlers = (extra = []) => [
    http.get(apiUrl('/teams/3'), () => HttpResponse.json(TEAM)),
    http.get(apiUrl('/users'), () => HttpResponse.json(page([MEMBER, { ...MEMBER, id: 6, name: 'Erin Walsh', permissions: { update: true, delete: false, editable_fields: ['weekly_capacity_hours'] } }]))),
    http.get(apiUrl('/reports/capacity'), () => HttpResponse.json(CAPACITY)),
    http.get(apiUrl('/leaves'), () => HttpResponse.json(page([LEAVE]))),
    ...extra,
  ];

  it('shows availability and flags over-allocation', async () => {
    server.use(...sessionHandlers('team_lead'), ...memberHandlers());
    renderWithApp(routes(), { route: '/teams/3' });
    expect(await screen.findByRole('heading', { name: 'Platform' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Team members' });
    const dan = within(table).getByText('Dan Okafor').closest('tr');
    expect(within(dan).getByText('Over')).toBeInTheDocument();
    expect(within(dan).getByText('157.1%')).toBeInTheDocument();
    expect(within(dan).getByText('56')).toBeInTheDocument(); // available hours
    expect(within(table).getByText('50%')).toBeInTheDocument();
    expect(screen.getByText(/Mar 9, 2026 – Mar 11, 2026 · 3 day\(s\)/)).toBeInTheDocument();
  });

  it('lets the team lead change capacity and record leave for a member', async () => {
    let capacity;
    let leave;
    server.use(
      ...sessionHandlers('team_lead'),
      ...memberHandlers([
        http.put(apiUrl('/users/5'), async ({ request }) => { capacity = await request.json(); return HttpResponse.json(MEMBER); }),
        http.post(apiUrl('/leaves'), async ({ request }) => { leave = await request.json(); return HttpResponse.json(LEAVE, { status: 201 }); }),
      ]),
    );
    renderWithApp(routes(), { route: '/teams/3' });
    await userEvent.click(await screen.findByRole('button', { name: 'Change capacity of Dan Okafor' }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText(/hours per week/i));
    await userEvent.type(within(dialog).getByLabelText(/hours per week/i), '32');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(capacity).toEqual({ weekly_capacity_hours: 32 }));

    await userEvent.click(screen.getByRole('button', { name: 'Record leave' }));
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText(/person/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Erin Walsh' }));
    await userEvent.type(within(dialog).getByLabelText(/first day/i), '2026-04-06');
    await userEvent.type(within(dialog).getByLabelText(/last day/i), '2026-04-07');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(leave).toMatchObject({ user_id: 6, start_date: '2026-04-06', end_date: '2026-04-07' }));
  });

  it('offers no editing to people who do not lead the team, and reports missing teams', async () => {
    const locked = { ...MEMBER, permissions: { update: false, delete: false, editable_fields: [] } };
    server.use(
      ...sessionHandlers('team_member'),
      http.get(apiUrl('/teams/3'), () => HttpResponse.json({ ...TEAM, lead_id: 99 })),
      http.get(apiUrl('/users'), () => HttpResponse.json(page([locked]))),
      http.get(apiUrl('/reports/capacity'), () => HttpResponse.json(CAPACITY)),
      http.get(apiUrl('/leaves'), () => HttpResponse.json(page([{ ...LEAVE, permissions: { update: false, delete: false, editable_fields: [] } }]))),
      http.get(apiUrl('/teams/404'), () => HttpResponse.json({ error: { code: 'not_found', message: 'x' } }, { status: 404 })),
    );
    const { unmount } = renderWithApp(routes(), { route: '/teams/3' });
    expect(within(await screen.findByRole('table', { name: 'Team members' })).getByText('Dan Okafor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record leave' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change capacity/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit leave of/ })).not.toBeInTheDocument();
    unmount();
    renderWithApp(routes(), { route: '/teams/404' });
    expect(await screen.findByText('This team does not exist.')).toBeInTheDocument();
  });
});

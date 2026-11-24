import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import LeavePage from './LeavePage';
import { LEAVE, MEMBER, page, sessionHandlers } from '../../test/fixtures';
import { renderWithApp } from '../../test/render';
import { apiUrl, server } from '../../test/server';

const list = (rows = [LEAVE]) => http.get(apiUrl('/leaves'), () => HttpResponse.json(page(rows)));

async function fillLeave(dialog, { first = '2026-03-09', last = '2026-03-11' } = {}) {
  await userEvent.type(within(dialog).getByLabelText(/first day/i), first);
  await userEvent.type(within(dialog).getByLabelText(/last day/i), last);
}

describe('Planned leave', () => {
  it('lists leave with its length and filters by date and owner', async () => {
    const queries = [];
    server.use(...sessionHandlers('team_member'), http.get(apiUrl('/leaves'), ({ request }) => {
      queries.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(page([LEAVE]));
    }));
    renderWithApp(<LeavePage />, { route: '/leave' });
    expect(await screen.findByText('Dan Okafor')).toBeInTheDocument();
    expect(screen.getByText('Family trip')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // days
    expect(queries[0]).toMatchObject({ sort: '-start_date' });
    await userEvent.type(screen.getByLabelText('From'), '2026-03-01');
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ from: '2026-03-01' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Only mine' }));
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ user_id: 'me', from: '2026-03-01' }));
  });

  it('lets a member record their own leave without choosing a person', async () => {
    let body;
    server.use(
      ...sessionHandlers('team_member'), list([]),
      http.post(apiUrl('/leaves'), async ({ request }) => { body = await request.json(); return HttpResponse.json({ ...LEAVE, ...body }, { status: 201 }); }),
    );
    renderWithApp(<LeavePage />, { route: '/leave' });
    await userEvent.click(await screen.findByRole('button', { name: 'Record leave' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/person/i)).not.toBeInTheDocument();
    await fillLeave(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(body).toEqual({ type: 'vacation', start_date: '2026-03-09', end_date: '2026-03-11', note: null }));
    expect(await screen.findByText('Leave recorded')).toBeInTheDocument();
  });

  it('shows the server reason when leave overlaps, and validates dates first', async () => {
    server.use(
      ...sessionHandlers('team_member'), list([]),
      http.post(apiUrl('/leaves'), () => HttpResponse.json({ error: { code: 'validation_error', message: 'Request validation failed',
        details: { start_date: 'overlaps existing leave (2026-03-09 to 2026-03-11)' } } }, { status: 400 })),
    );
    renderWithApp(<LeavePage />, { route: '/leave' });
    await userEvent.click(await screen.findByRole('button', { name: 'Record leave' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record' }));
    expect(within(dialog).getAllByText('Required')).toHaveLength(2); // both dates, before any request
    await fillLeave(dialog, { first: '2026-03-10', last: '2026-03-12' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record' }));
    expect(await within(dialog).findByText(/overlaps existing leave/)).toBeInTheDocument();
  });

  it('lets a team lead record leave for a team member', async () => {
    let body;
    server.use(
      ...sessionHandlers('team_lead'), list([]),
      http.get(apiUrl('/teams'), () => HttpResponse.json(page([{ id: 3 }]))),
      http.get(apiUrl('/users'), () => HttpResponse.json(page([MEMBER]))),
      http.post(apiUrl('/leaves'), async ({ request }) => { body = await request.json(); return HttpResponse.json(LEAVE, { status: 201 }); }),
    );
    renderWithApp(<LeavePage />, { route: '/leave' });
    await userEvent.click(await screen.findByRole('button', { name: 'Record leave' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText(/person/i));
    expect(await screen.findByRole('option', { name: 'Pat team lead (you)' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('option', { name: 'Dan Okafor' }));
    await fillLeave(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(body).toMatchObject({ user_id: 5, type: 'vacation' }));
  });

  it('is read-only for viewers, and edits or deletes where allowed', async () => {
    server.use(...sessionHandlers('viewer'), list([{ ...LEAVE, permissions: { update: false, delete: false, editable_fields: [] } }]));
    const { unmount } = renderWithApp(<LeavePage />, { route: '/leave' });
    expect(await screen.findByText('Dan Okafor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record leave' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit leave of/ })).not.toBeInTheDocument();
    unmount();

    let update;
    let removed = false;
    server.use(
      ...sessionHandlers('team_member'), list(),
      http.put(apiUrl('/leaves/21'), async ({ request }) => { update = await request.json(); return HttpResponse.json(LEAVE); }),
      http.delete(apiUrl('/leaves/21'), () => { removed = true; return new HttpResponse(null, { status: 204 }); }),
    );
    renderWithApp(<LeavePage />, { route: '/leave' });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit leave of Dan Okafor' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText(/note/i));
    await userEvent.type(within(dialog).getByLabelText(/note/i), 'Moved');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toEqual({ note: 'Moved' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete leave of Dan Okafor' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(removed).toBe(true));
  });
});

import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import DeliverablesPage from './DeliverablesPage';
import { DELIVERABLE, page, sessionHandlers } from '../../test/fixtures';
import { renderWithApp } from '../../test/render';
import { apiUrl, server } from '../../test/server';

const OTHER = { ...DELIVERABLE, id: 12, key: 'WEB-4', number: 4, name: 'Launch campaign', status: 'not_started', owner_id: null, owner_name: null,
  due_date: null, is_overdue: false, permissions: { update: false, delete: false, editable_fields: [] } };
const list = (rows = [DELIVERABLE, OTHER]) => http.get(apiUrl('/deliverables'), () => HttpResponse.json(page(rows)));

describe('Changing status in place', () => {
  it('changes a deliverable\'s status from the list without opening it', async () => {
    const updates = [];
    server.use(...sessionHandlers('team_member'), list(), http.put(apiUrl('/deliverables/11'), async ({ request }) => {
      updates.push(await request.json());
      return HttpResponse.json({ ...DELIVERABLE, status: 'completed' });
    }));
    renderWithApp(<DeliverablesPage />, { route: '/deliverables' });
    await userEvent.click(await screen.findByRole('button', { name: /Status of WEB-3: In progress/ }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Not started', 'In progress', 'Blocked', 'Completed']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Completed' }));
    await waitFor(() => expect(updates).toEqual([{ status: 'completed' }]));
    expect(await screen.findByText('WEB-3 is now completed')).toBeInTheDocument();
  });

  it('shows the rule that stopped a change', async () => {
    server.use(...sessionHandlers('team_member'), list(), http.put(apiUrl('/deliverables/11'), () => HttpResponse.json(
      { error: { code: 'validation_error', message: 'Request validation failed', details: { status: 'cannot complete while blocked by WEB-1' } } }, { status: 400 })));
    renderWithApp(<DeliverablesPage />, { route: '/deliverables' });
    await userEvent.click(await screen.findByRole('button', { name: /Status of WEB-3/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Completed' }));
    expect(await screen.findByText('WEB-3: cannot complete while blocked by WEB-1')).toBeInTheDocument();
  });

  it('does nothing when the same status is picked, and offers no menu to people who may not change it', async () => {
    let called = false;
    server.use(...sessionHandlers('team_member'), list(), http.put(apiUrl('/deliverables/11'), () => { called = true; return HttpResponse.json(DELIVERABLE); }));
    renderWithApp(<DeliverablesPage />, { route: '/deliverables' });
    await userEvent.click(await screen.findByRole('button', { name: /Status of WEB-3/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'In progress' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(called).toBe(false);
    expect(screen.queryByRole('button', { name: /Status of WEB-4/ })).not.toBeInTheDocument();
    const grid = screen.getByRole('grid');
    expect(within(grid).getByText('Unassigned')).toBeInTheDocument();          // the owner cell, not the filter chip
    expect(within(grid).getByText('No due date')).toBeInTheDocument();
  });
});

describe('Board view', () => {
  it('shows one column per status and remembers the view in the address', async () => {
    const queries = [];
    server.use(...sessionHandlers('team_member'), http.get(apiUrl('/deliverables'), ({ request }) => {
      queries.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(page([DELIVERABLE, OTHER]));
    }));
    renderWithApp(<DeliverablesPage />, { route: '/deliverables' });
    await screen.findByText('Design system');
    await userEvent.click(screen.getByRole('button', { name: 'Board view' }));
    const doing = await screen.findByRole('region', { name: 'In progress (1)' });
    expect(within(doing).getByRole('link', { name: 'WEB-3' })).toHaveAttribute('href', '/deliverables/WEB-3');
    expect(within(screen.getByRole('region', { name: 'Not started (1)' })).getByText('Launch campaign')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Blocked (0)' })).getByText('Nothing here.')).toBeInTheDocument();
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ limit: '200', offset: '0' }));
    await userEvent.click(screen.getByRole('button', { name: 'Table view' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'In progress (1)' })).not.toBeInTheDocument());
  });

  it('moves a card by changing its status, and says when the board is cut short', async () => {
    const updates = [];
    server.use(...sessionHandlers('team_member'),
      http.get(apiUrl('/deliverables'), () => HttpResponse.json({ ...page([DELIVERABLE]), total: 250 })),
      http.put(apiUrl('/deliverables/11'), async ({ request }) => { updates.push(await request.json()); return HttpResponse.json({ ...DELIVERABLE, status: 'blocked' }); }));
    renderWithApp(<DeliverablesPage />, { route: '/deliverables?view=board' });
    expect(await screen.findByText(/Showing the first 1 of 250/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Status of WEB-3/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Blocked' }));
    await waitFor(() => expect(updates).toEqual([{ status: 'blocked' }]));
  });

  it('narrows to one person\'s work and filters unassigned', async () => {
    const queries = [];
    server.use(...sessionHandlers('project_manager'), http.get(apiUrl('/deliverables'), ({ request }) => {
      queries.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(page([DELIVERABLE]));
    }));
    const { unmount } = renderWithApp(<DeliverablesPage />, { route: '/deliverables?person=5' });
    await screen.findByText(/One person's deliverables/);
    expect(queries.at(-1)).toMatchObject({ owner_id: '5' });
    unmount();
    renderWithApp(<DeliverablesPage />, { route: '/deliverables' });
    await userEvent.click(await screen.findByRole('button', { name: 'Unassigned' }));
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ unassigned: 'true' }));
    const mine = screen.getByRole('button', { name: 'Mine' });
    await userEvent.click(mine);
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ owner_id: 'me' }));
    expect(mine).toHaveAttribute('aria-pressed', 'true');                 // still there, so it can be switched off
    await userEvent.click(screen.getByRole('button', { name: 'Mine' }));
    await waitFor(() => expect(queries.at(-1).owner_id).toBeUndefined());
  });
});

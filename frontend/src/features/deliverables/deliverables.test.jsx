import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import MyWorkPage from './MyWorkPage';
import { DELIVERABLE, page, sessionHandlers } from '../../test/fixtures';
import { renderWithApp } from '../../test/render';
import { apiUrl, server } from '../../test/server';

describe('My work', () => {
  it('lists my deliverables and lets the owner change only status and progress', async () => {
    let update;
    server.use(
      ...sessionHandlers('team_member'),
      http.get(apiUrl('/deliverables'), ({ request }) => {
        expect(new URL(request.url).searchParams.get('owner_id')).toBe('me');
        return HttpResponse.json(page([DELIVERABLE]));
      }),
      http.get(apiUrl('/users'), () => HttpResponse.json(page([]))),
      http.put(apiUrl('/deliverables/11'), async ({ request }) => {
        update = await request.json();
        return HttpResponse.json({ ...DELIVERABLE, ...update });
      }),
    );
    renderWithApp(<MyWorkPage />, { route: '/my-work' });
    expect(await screen.findByText('Design system')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Design system' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Edit Design system' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/^name/i)).toBeDisabled();
    expect(within(dialog).getByLabelText(/due date/i)).toBeDisabled();
    await userEvent.click(within(dialog).getByLabelText(/status/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Completed' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toEqual({ status: 'completed' }));
    expect(await screen.findByText('Deliverable updated')).toBeInTheDocument();
  });

  it('filters by status and overdue', async () => {
    const queries = [];
    server.use(...sessionHandlers('team_member'), http.get(apiUrl('/deliverables'), ({ request }) => {
      queries.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(page([]));
    }));
    renderWithApp(<MyWorkPage />, { route: '/my-work' });
    expect(await screen.findByText('No deliverables match.')).toBeInTheDocument();
    const overdue = screen.getByRole('button', { name: 'Overdue' });
    await userEvent.click(overdue);
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ overdue: 'true', owner_id: 'me' }));
    expect(overdue).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Mine' })).not.toBeInTheDocument();   // already only mine
    await userEvent.click(overdue);                                                     // a second click clears it
    await waitFor(() => expect(queries.at(-1).overdue).toBeUndefined());
  });

  it('shows cards with actions on mobile', async () => {
    server.use(...sessionHandlers('team_member'), http.get(apiUrl('/deliverables'), () => HttpResponse.json(page([DELIVERABLE]))));
    renderWithApp(<MyWorkPage />, { route: '/my-work', width: 375 });
    expect(await screen.findByText('Design system')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Design system' })).toBeInTheDocument();
  });
});

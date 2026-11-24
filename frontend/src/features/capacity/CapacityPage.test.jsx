import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import CapacityPage from './CapacityPage';
import { CAPACITY, page, sessionHandlers } from '../../test/fixtures';
import { renderWithApp } from '../../test/render';
import { apiUrl, server } from '../../test/server';

const lookups = () => [
  http.get(apiUrl('/teams'), () => HttpResponse.json(page([{ id: 3, name: 'Platform' }]))),
  http.get(apiUrl('/departments'), () => HttpResponse.json(page([{ id: 1, name: 'Engineering', code: 'ENG' }]))),
];

describe('Capacity report', () => {
  it('lists people with over-allocated first, and summarizes the window', async () => {
    const queries = [];
    server.use(...sessionHandlers('viewer'), ...lookups(), http.get(apiUrl('/reports/capacity'), ({ request }) => {
      queries.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(CAPACITY);
    }));
    renderWithApp(<CapacityPage />, { route: '/capacity' });
    const table = await screen.findByRole('table', { name: 'Capacity by person' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Dan Okafor')).toBeInTheDocument(); // over-allocated sorts first
    expect(within(rows[0]).getByText('Over-allocated')).toBeInTheDocument();
    expect(within(rows[0]).getByText('157.1%')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Other · 40 h')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Erin Walsh')).toBeInTheDocument();
    expect(within(rows[1]).getByText('40 h free')).toBeInTheDocument();
    expect(screen.getByText(/over-allocated above 100%/)).toBeInTheDocument();
    expect(within(rows[1]).getByText('2 not counted')).toBeInTheDocument(); // no estimate or due date
    expect(within(rows[0]).queryByText(/not counted/)).not.toBeInTheDocument();
    expect(screen.getByText('136')).toBeInTheDocument(); // available hours tile
    expect(queries[0]).toEqual({}); // defaults come from the server
  });

  it('sends the chosen window and filters', async () => {
    const queries = [];
    server.use(...sessionHandlers('admin'), ...lookups(), http.get(apiUrl('/reports/capacity'), ({ request }) => {
      queries.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(CAPACITY);
    }));
    renderWithApp(<CapacityPage />, { route: '/capacity' });
    await screen.findByRole('table', { name: 'Capacity by person' });
    await userEvent.type(screen.getByLabelText('From'), '2026-03-02');
    await userEvent.type(screen.getByLabelText('To'), '2026-03-13');
    await userEvent.click(screen.getByLabelText('Team'));
    await userEvent.click(await screen.findByRole('option', { name: 'Platform' }));
    await waitFor(() => expect(queries.at(-1)).toEqual({ from: '2026-03-02', to: '2026-03-13', team_id: '3' }));
  });

  it('shows cards on mobile, empty results and server errors', async () => {
    server.use(...sessionHandlers('viewer'), ...lookups(), http.get(apiUrl('/reports/capacity'), () => HttpResponse.json(CAPACITY)));
    const { unmount } = renderWithApp(<CapacityPage />, { route: '/capacity', width: 375 });
    expect(await screen.findByText('Dan Okafor')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('88 of 56 h available · 3 leave day(s)')).toBeInTheDocument();
    unmount();

    server.use(http.get(apiUrl('/reports/capacity'), () => HttpResponse.json({ ...CAPACITY, data: [], summary: { ...CAPACITY.summary, people: 0 } })));
    const empty = renderWithApp(<CapacityPage />, { route: '/capacity' });
    expect(await screen.findByText('No one matches these filters.')).toBeInTheDocument();
    empty.unmount();

    server.use(http.get(apiUrl('/reports/capacity'), () => HttpResponse.json(
      { error: { code: 'validation_error', message: 'x', details: { to: 'must be on or after from' } } }, { status: 400 },
    )));
    renderWithApp(<CapacityPage />, { route: '/capacity' });
    expect(await screen.findByText('must be on or after from')).toBeInTheDocument();
  });
});

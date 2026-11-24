import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import BudgetPage from './BudgetPage';
import { BUDGET, page, sessionHandlers } from '../../test/fixtures';
import { renderWithApp } from '../../test/render';
import { apiUrl, server } from '../../test/server';

const departments = http.get(apiUrl('/departments'), () => HttpResponse.json(page([{ id: 1, name: 'Marketing', code: 'MKT' }])));

describe('Budget page', () => {
  it('ranks projects by how much of their budget is spent', async () => {
    server.use(...sessionHandlers('viewer'), departments, http.get(apiUrl('/reports/budget'), () => HttpResponse.json(BUDGET)));
    renderWithApp(<BudgetPage />, { route: '/budget' });
    const table = await screen.findByRole('table', { name: 'Budget by project' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByRole('link', { name: 'PAY' })).toHaveAttribute('href', '/projects/PAY?tab=budget'); // 120% first
    expect(within(rows[0]).getByText('Off track')).toBeInTheDocument();
    expect(within(rows[0]).getByText('-$6,000')).toBeInTheDocument();
    expect(within(rows[1]).getByText('At risk')).toBeInTheDocument();
    expect(screen.getByText('$150,000')).toBeInTheDocument();
    expect(screen.getByText('80% of planned')).toBeInTheDocument();
    expect(screen.getByText('Spending by category')).toBeInTheDocument();
    expect(screen.getByText('Labor')).toBeInTheDocument();
  });

  it('narrows to a department', async () => {
    const queries = [];
    server.use(...sessionHandlers('viewer'), departments, http.get(apiUrl('/reports/budget'), ({ request }) => {
      queries.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(BUDGET);
    }));
    renderWithApp(<BudgetPage />, { route: '/budget' });
    await userEvent.click(await screen.findByLabelText('Department'));
    await userEvent.click(await screen.findByRole('option', { name: 'Marketing (MKT)' }));
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ department_id: '1' }));
  });

  it('copes with no projects and with failures', async () => {
    server.use(...sessionHandlers('viewer'), departments, http.get(apiUrl('/reports/budget'), () => HttpResponse.json({
      totals: { projects: 0, planned_budget: 0, spent: 0, remaining: 0, burn_pct: null, over_budget: 0 }, data: [], by_category: [], by_month: [],
    })));
    const { unmount } = renderWithApp(<BudgetPage />, { route: '/budget' });
    expect(await screen.findByText('No projects match.')).toBeInTheDocument();
    unmount();

    server.use(http.get(apiUrl('/reports/budget'), () => HttpResponse.json({ error: { code: 'internal_error', message: 'Boom' } }, { status: 500 })));
    renderWithApp(<BudgetPage />, { route: '/budget' });
    expect(await screen.findByText('Boom')).toBeInTheDocument();
  });
});

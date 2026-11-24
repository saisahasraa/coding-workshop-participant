import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import ProjectDetailPage from './ProjectDetailPage';
import { BUDGET, DEPENDENCIES, EXPENSE, page, PROJECT, sessionHandlers } from '../../test/fixtures';
import { renderWithApp } from '../../test/render';
import { apiUrl, server } from '../../test/server';

const routes = () => <Routes><Route path="/projects/:id" element={<ProjectDetailPage />} /></Routes>;
const report = { ...BUDGET, totals: { ...BUDGET.totals, projects: 1 }, data: [BUDGET.data[0]] };

/** Default handlers; ones passed in come first so a test can override them (MSW uses the first match). */
const base = (extra = []) => [
  ...extra,
  http.get(apiUrl('/projects/WEB'), () => HttpResponse.json(PROJECT)),
  http.get(apiUrl('/reports/budget'), () => HttpResponse.json(report)),
  http.get(apiUrl('/expenses'), () => HttpResponse.json(page([EXPENSE]))),
  http.get(apiUrl('/projects/WEB/dependencies'), () => HttpResponse.json(DEPENDENCIES)),
];

describe('Project overview health and budget', () => {
  it('explains why a project is at risk and shows spending', async () => {
    server.use(...sessionHandlers('viewer'), ...base());
    renderWithApp(routes(), { route: '/projects/WEB' });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('At risk')).toBeInTheDocument();
    expect(within(alert).getByText('1 deliverable overdue, the longest by 3 days')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '70% of budget spent' })).toBeInTheDocument();
  });

  it('says so when a running project has nothing wrong', async () => {
    server.use(...sessionHandlers('viewer'), ...base([http.get(apiUrl('/projects/WEB'), () => HttpResponse.json({ ...PROJECT, health: 'green', health_reasons: [] }))]));
    renderWithApp(routes(), { route: '/projects/WEB' });
    expect(await screen.findByText(/all within their limits/)).toBeInTheDocument();
  });

  it('shows no health for projects that are not running', async () => {
    server.use(...sessionHandlers('viewer'), ...base([http.get(apiUrl('/projects/WEB'), () => HttpResponse.json({ ...PROJECT, status: 'planning', health: null, health_reasons: [] }))]));
    renderWithApp(routes(), { route: '/projects/WEB' });
    await screen.findByRole('heading', { name: /Website relaunch/ });
    expect(screen.queryByText('On track')).not.toBeInTheDocument();
    expect(screen.queryByText('At risk')).not.toBeInTheDocument();
  });
});

describe('Project budget tab', () => {
  it('shows the figures, where the money went and the expenses', async () => {
    server.use(...sessionHandlers('viewer'), ...base());
    renderWithApp(routes(), { route: '/projects/WEB?tab=budget' });
    expect(await screen.findByText('$84,000')).toBeInTheDocument();
    expect(screen.getByText('$36,000')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('Labor')).toBeInTheDocument();
    expect(screen.getByText('2026-03')).toBeInTheDocument();
    expect(await screen.findByText('Licences')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add expense' })).not.toBeInTheDocument();
  });

  it('lets the manager add, edit and delete expenses', async () => {
    const calls = [];
    server.use(...sessionHandlers('project_manager'), ...base([
      http.post(apiUrl('/expenses'), async ({ request }) => { calls.push(['POST', await request.json()]); return HttpResponse.json(EXPENSE, { status: 201 }); }),
      http.put(apiUrl('/expenses/31'), async ({ request }) => { calls.push(['PUT', await request.json()]); return HttpResponse.json(EXPENSE); }),
      http.delete(apiUrl('/expenses/31'), () => { calls.push(['DELETE']); return new HttpResponse(null, { status: 204 }); }),
    ]));
    renderWithApp(routes(), { route: '/projects/WEB?tab=budget' });
    await userEvent.click(await screen.findByRole('button', { name: 'Add expense' }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^amount/i), '250');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls[0]).toEqual(['POST', expect.objectContaining({ amount: 250, category: 'labor', project_id: 7 })]));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(await screen.findByRole('button', { name: /^Edit Software expense/ }));
    dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText(/^amount/i));
    await userEvent.type(within(dialog).getByLabelText(/^amount/i), '999');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls[1]).toEqual(['PUT', { amount: 999 }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(await screen.findByRole('button', { name: /^Delete Software expense/ }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(calls[2]).toEqual(['DELETE']));
  });

  it('filters expenses by category', async () => {
    const queries = [];
    server.use(...sessionHandlers('viewer'), ...base([http.get(apiUrl('/expenses'), ({ request }) => {
      queries.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(page([EXPENSE]));
    })]));
    renderWithApp(routes(), { route: '/projects/WEB?tab=budget' });
    await userEvent.click(await screen.findByLabelText('Category'));
    await userEvent.click(await screen.findByRole('option', { name: 'Travel' }));
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ category: 'travel', project_id: '7' }));
  });

  it('flags overspending and handles an empty project', async () => {
    const empty = { ...report, data: [{ ...BUDGET.data[1], key: 'WEB' }], by_category: [], by_month: [] };
    server.use(...sessionHandlers('viewer'), ...base([
      http.get(apiUrl('/reports/budget'), () => HttpResponse.json(empty)),
      http.get(apiUrl('/expenses'), () => HttpResponse.json(page([]))),
    ]));
    renderWithApp(routes(), { route: '/projects/WEB?tab=budget' });
    expect(await screen.findByText('120%')).toBeInTheDocument();
    expect(screen.getAllByText('Nothing spent yet.')).toHaveLength(2);
    expect(screen.getByText('No expenses recorded.')).toBeInTheDocument();
  });

  it('reports a failing budget report', async () => {
    server.use(...sessionHandlers('viewer'), ...base([http.get(apiUrl('/reports/budget'), () => HttpResponse.json({ error: { code: 'internal_error', message: 'Boom' } }, { status: 500 }))]));
    renderWithApp(routes(), { route: '/projects/WEB?tab=budget' });
    expect(await screen.findByText('Boom')).toBeInTheDocument();
  });
});

describe('Project dependencies tab', () => {
  it('draws the chain and lists who waits for whom', async () => {
    server.use(...sessionHandlers('viewer'), ...base());
    renderWithApp(routes(), { route: '/projects/WEB?tab=dependencies' });
    expect(await screen.findByText('3 dependencies')).toBeInTheDocument();
    expect(screen.getByText('Longest chain: 2 items')).toBeInTheDocument();
    expect(screen.getByText('Build pages')).toBeInTheDocument();
    expect(screen.getByText('Provision hosting')).toBeInTheDocument(); // another project's work, drawn dashed
    const waiting = screen.getByRole('region', { name: 'Waiting on' });
    expect(within(waiting).getByText('WEB-2')).toBeInTheDocument();
    expect(within(waiting).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(
      ['/deliverables/WEB-2', '/deliverables/WEB-1', '/deliverables/WEB-3', '/deliverables/WEB-1', '/deliverables/OPS-4']);
  });

  it('explains how to create dependencies when there are none', async () => {
    server.use(...sessionHandlers('viewer'), ...base([http.get(apiUrl('/projects/WEB/dependencies'), () => HttpResponse.json({ ...DEPENDENCIES, nodes: [], edges: [], longest_chain: 0 }))]));
    renderWithApp(routes(), { route: '/projects/WEB?tab=dependencies' });
    expect(await screen.findByText(/No dependencies yet/)).toBeInTheDocument();
  });

  it('reports failures', async () => {
    server.use(...sessionHandlers('viewer'), ...base([http.get(apiUrl('/projects/WEB/dependencies'), () => HttpResponse.json({ error: { code: 'internal_error', message: 'Boom' } }, { status: 500 }))]));
    renderWithApp(routes(), { route: '/projects/WEB?tab=dependencies' });
    expect(await screen.findByText('Boom')).toBeInTheDocument();
  });
});

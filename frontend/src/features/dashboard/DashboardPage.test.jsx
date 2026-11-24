import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import DashboardPage from './DashboardPage';
import { sessionHandlers, SUMMARY } from '../../test/fixtures';
import { renderWithApp } from '../../test/render';
import { apiUrl, server } from '../../test/server';

const summary = (body = SUMMARY) => http.get(apiUrl('/reports/summary'), () => HttpResponse.json(body));

describe('Dashboard', () => {
  it('answers the headline questions at a glance', async () => {
    server.use(...sessionHandlers('project_manager'), summary());
    renderWithApp(<DashboardPage />);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    const tile = (label) => screen.getByText(label).closest('div');
    expect(within(tile('Running projects')).getByText('3')).toBeInTheDocument();
    expect(within(tile('At risk or off track')).getByText('2')).toBeInTheDocument();
    expect(within(tile('Overdue deliverables')).getByText('2')).toBeInTheDocument();
    expect(within(tile('Over-allocated people')).getByText('1')).toBeInTheDocument();
    expect(within(tile('Budget spent')).getByText('80%')).toBeInTheDocument();
  });

  it('lists the projects needing attention with their reasons', async () => {
    server.use(...sessionHandlers('viewer'), summary());
    renderWithApp(<DashboardPage />);
    const list = (await screen.findByText('Needs attention')).closest('div').parentElement;
    expect(within(list).getByRole('link', { name: 'PAY' })).toHaveAttribute('href', '/projects/PAY');
    expect(within(list).getByText(/1 deliverable overdue, the longest by 10 days \(\+1 more\)/)).toBeInTheDocument();
    expect(within(list).getByText('Off track')).toBeInTheDocument();
    expect(within(list).getByText(/67% of the schedule has passed/)).toBeInTheDocument();
  });

  it('shows health, status, budget and workload as labelled bars', async () => {
    server.use(...sessionHandlers('project_manager'), summary());
    renderWithApp(<DashboardPage />);
    expect(await screen.findByRole('progressbar', { name: 'At risk: 1' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Off track' })).toHaveAttribute('href', '/projects?health=red');
    expect(screen.getByRole('progressbar', { name: 'In progress: 6' })).toBeInTheDocument();
    expect(screen.getByText(/1 without an owner/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '120% of budget spent' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '157.1% utilized' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dan Okafor: all deliverables' })).toHaveAttribute('href', '/deliverables?person=5');
  });

  it('shows my work, except to viewers', async () => {
    server.use(...sessionHandlers('team_member'), summary());
    const { unmount } = renderWithApp(<DashboardPage />);
    const mine = (await screen.findByText('My work')).closest('div').parentElement;
    expect(within(mine).getByText('open')).toBeInTheDocument();
    expect(within(mine).getByRole('link', { name: 'Open my work' })).toHaveAttribute('href', '/my-work');
    unmount();

    server.use(...sessionHandlers('viewer'));
    renderWithApp(<DashboardPage />);
    await screen.findByText('Needs attention');
    expect(screen.queryByText('My work')).not.toBeInTheDocument();
  });

  it('copes with an empty system and with failures', async () => {
    const empty = {
      ...SUMMARY, projects: { ...SUMMARY.projects, total: 0, running: 0, by_health: { green: 0, amber: 0, red: 0 } }, needs_attention: [],
      budget: { planned_budget: 0, spent: 0, burn_pct: null, over_budget: 0, top: [] }, capacity: { ...SUMMARY.capacity, people: 0, over_allocated: 0, top: [] },
    };
    server.use(...sessionHandlers('viewer'), summary(empty));
    const { unmount } = renderWithApp(<DashboardPage />);
    expect(await screen.findByText('No running project is at risk.')).toBeInTheDocument();
    expect(screen.getByText('No project is running yet.')).toBeInTheDocument();
    expect(screen.getByText('No running project has a budget yet.')).toBeInTheDocument();
    expect(screen.getByText('Nobody has assigned work in this period.')).toBeInTheDocument();
    unmount();

    server.use(http.get(apiUrl('/reports/summary'), () => HttpResponse.json({ error: { code: 'internal_error', message: 'Boom' } }, { status: 500 })));
    renderWithApp(<DashboardPage />);
    expect(await screen.findByText('Boom')).toBeInTheDocument();
  });
});

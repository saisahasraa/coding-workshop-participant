import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import ProjectDetailPage from './ProjectDetailPage';
import { page, PROJECT, PROJECT_TEAM, sessionHandlers } from '../../test/fixtures';
import { renderWithApp } from '../../test/render';
import { apiUrl, server } from '../../test/server';

const routes = () => <Routes><Route path="/projects/:id" element={<ProjectDetailPage />} /></Routes>;
const handlers = (team = PROJECT_TEAM) => [
  http.get(apiUrl('/projects/WEB'), () => HttpResponse.json(PROJECT)),
  http.get(apiUrl('/projects/WEB/team'), () => HttpResponse.json(team)),
  http.get(apiUrl('/deliverables'), () => HttpResponse.json(page([]))),
];

describe('Project team tab', () => {
  it('lists the people working on the project and expands one to show their deliverables', async () => {
    server.use(...sessionHandlers('viewer'), ...handlers());
    renderWithApp(routes(), { route: '/projects/WEB?tab=team' });
    const dan = await screen.findByRole('button', { name: /Dan Okafor, 2 deliverables/ });
    expect(screen.getByText('20 h remaining of 50 h')).toBeInTheDocument();
    expect(screen.getByText('1 overdue')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.queryByText('Design system')).not.toBeInTheDocument(); // collapsed until opened

    await userEvent.click(dan);
    expect(await screen.findByText('Design system')).toBeInTheDocument();
    expect(screen.getByText('Launch campaign')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'WEB-3' })).toHaveAttribute('href', '/deliverables/WEB-3');
    expect(screen.getByText(/Overdue · /)).toBeInTheDocument();
    expect(screen.queryByText('Accessibility audit')).not.toBeInTheDocument(); // another person's group stays closed

    await userEvent.click(screen.getByRole('button', { name: /Unassigned, 1 deliverable$/ }));
    const row = (await screen.findByText('Accessibility audit')).closest('li');
    expect(within(row).getByText('No due date')).toBeInTheDocument();
    expect(within(row).getByText('No estimate')).toBeInTheDocument();

    await userEvent.click(dan);
    await screen.findByText('Accessibility audit');
    expect(screen.queryByText('Design system')).not.toBeInTheDocument(); // collapses again
  });

  it('explains an empty project and reports failures', async () => {
    server.use(...sessionHandlers('viewer'), ...handlers({ ...PROJECT_TEAM, data: [] }));
    const { unmount } = renderWithApp(routes(), { route: '/projects/WEB?tab=team' });
    expect(await screen.findByText(/nobody is working on this project/)).toBeInTheDocument();
    unmount();

    server.use(http.get(apiUrl('/projects/WEB/team'), () => HttpResponse.json({ error: { code: 'internal_error', message: 'Boom' } }, { status: 500 })));
    renderWithApp(routes(), { route: '/projects/WEB?tab=team' });
    expect(await screen.findByText('Boom')).toBeInTheDocument();
  });
});

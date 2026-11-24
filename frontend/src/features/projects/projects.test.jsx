import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import ProjectDetailPage from './ProjectDetailPage';
import ProjectsPage from './ProjectsPage';
import { DELIVERABLE, page, PROJECT, sessionHandlers } from '../../test/fixtures';
import { renderWithApp } from '../../test/render';
import { apiUrl, server } from '../../test/server';

const lookups = () => [
  http.get(apiUrl('/departments'), () => HttpResponse.json(page([{ id: 1, name: 'Marketing', code: 'MKT' }]))),
  http.get(apiUrl('/users'), () => HttpResponse.json(page([{ id: 2, name: 'Alice Morgan' }]))),
];

function routes() {
  return (
    <Routes>
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/projects/:id" element={<ProjectDetailPage />} />
    </Routes>
  );
}

describe('Project form', () => {
  it('groups fields into sections and saves who may edit and comment', async () => {
    let update;
    server.use(...sessionHandlers('project_manager'), ...lookups(),
      http.get(apiUrl('/projects/WEB'), () => HttpResponse.json(PROJECT)),
      http.get(apiUrl('/deliverables'), () => HttpResponse.json(page([]))),
      http.put(apiUrl('/projects/7'), async ({ request }) => { update = await request.json(); return HttpResponse.json({ ...PROJECT, ...update }); }));
    renderWithApp(routes(), { route: '/projects/WEB' });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    for (const section of ['Basics', 'Ownership', 'Plan', 'Access']) expect(within(dialog).getByRole('heading', { name: section })).toBeInTheDocument();
    expect(within(dialog).getByText('* required')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByLabelText(/Who can add and edit deliverables/));
    await userEvent.click(await screen.findByRole('option', { name: 'Project members only' }));
    await userEvent.click(within(dialog).getByLabelText(/Who can comment and attach files/));
    await userEvent.click(await screen.findByRole('option', { name: 'Everyone except viewers' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toEqual({ edit_access: 'members', comment_access: 'everyone' }));
  });

  it('lets a manager of another project change only the planned budget', async () => {
    let update;
    const budgetOnly = { ...PROJECT, permissions: { update: true, delete: false, editable_fields: ['planned_budget'], add_deliverables: true } };
    server.use(...sessionHandlers('project_manager'), ...lookups(),
      http.get(apiUrl('/projects/WEB'), () => HttpResponse.json(budgetOnly)),
      http.get(apiUrl('/deliverables'), () => HttpResponse.json(page([]))),
      http.put(apiUrl('/projects/7'), async ({ request }) => { update = await request.json(); return HttpResponse.json({ ...PROJECT, ...update }); }));
    renderWithApp(routes(), { route: '/projects/WEB' });
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/^Name/)).toBeDisabled();
    expect(within(dialog).getByLabelText(/Who can add and edit deliverables/)).toHaveAttribute('aria-disabled', 'true');
    const budget = within(dialog).getByLabelText(/Planned budget/);
    expect(budget).toBeEnabled();
    await userEvent.clear(budget);
    await userEvent.type(budget, '150000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toEqual({ planned_budget: 150000 }));
  });

  it('closes from the corner button without saving', async () => {
    server.use(...sessionHandlers('project_manager'), ...lookups(),
      http.get(apiUrl('/projects/WEB'), () => HttpResponse.json(PROJECT)),
      http.get(apiUrl('/deliverables'), () => HttpResponse.json(page([]))));
    renderWithApp(routes(), { route: '/projects/WEB' });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('Projects list', () => {
  it('lists projects and passes search and filters to the API', async () => {
    const queries = [];
    server.use(...sessionHandlers('project_manager'), http.get(apiUrl('/projects'), ({ request }) => {
      queries.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(page([PROJECT]));
    }));
    renderWithApp(routes(), { route: '/projects' });
    expect(await screen.findByText('Website relaunch')).toBeInTheDocument();
    expect(screen.getByText('Alice Morgan')).toBeInTheDocument();
    expect(queries[0]).toMatchObject({ sort: 'key', limit: '25', offset: '0' });

    await userEvent.type(screen.getByLabelText(/search key/i), 'web');
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ q: 'web' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Managed by me' }));
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ manager_id: 'me', q: 'web' }));
  });

  it('shows each project\'s health and filters on it', async () => {
    const queries = [];
    server.use(...sessionHandlers('viewer'), http.get(apiUrl('/projects'), ({ request }) => {
      queries.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(page([PROJECT]));
    }));
    renderWithApp(routes(), { route: '/projects' });
    expect(await screen.findByText('At risk')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '70% of budget spent' })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Health'));
    await userEvent.click(await screen.findByRole('option', { name: 'At risk or off track' }));
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ health: 'amber,red' }));
  });

  it('creates a project and opens it', async () => {
    let created;
    server.use(
      ...sessionHandlers('project_manager'), ...lookups(),
      http.get(apiUrl('/projects'), () => HttpResponse.json(page([]))),
      http.post(apiUrl('/projects'), async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({ ...PROJECT, ...created }, { status: 201 });
      }),
      http.get(apiUrl('/projects/WEB'), () => HttpResponse.json(PROJECT)),
    );
    renderWithApp(routes(), { route: '/projects' });
    expect(await screen.findByText('No projects match these filters.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New project' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/project manager/i)).not.toBeInTheDocument(); // PMs manage their own
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'Website relaunch');
    const key = within(dialog).getByLabelText(/project key/i);
    expect(key).toHaveValue('WEBR'); // suggested from the name
    await userEvent.clear(key);
    await userEvent.type(key, 'web-1x');
    expect(key).toHaveValue('WEB1X'); // upper-cased, symbols dropped
    await userEvent.clear(key);
    await userEvent.type(key, 'web');
    await userEvent.click(within(dialog).getByLabelText(/department/i));
    await userEvent.click(await screen.findByRole('option', { name: 'Marketing (MKT)' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('heading', { name: 'WEB · Website relaunch' })).toBeInTheDocument();
    expect(created).toMatchObject({ key: 'WEB', name: 'Website relaunch', department_id: 1, status: 'planning', visibility: 'inherit' });
  });

  it('renders cards on mobile', async () => {
    server.use(...sessionHandlers('viewer'), http.get(apiUrl('/projects'), () => HttpResponse.json(page([PROJECT]))));
    renderWithApp(routes(), { route: '/projects', width: 375 });
    expect(await screen.findByText('WEB · Website relaunch')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });
});

describe('Project detail', () => {
  it('shows the overview and the deliverables tab', async () => {
    server.use(
      ...sessionHandlers('project_manager'),
      http.get(apiUrl('/projects/WEB'), () => HttpResponse.json(PROJECT)),
      http.get(apiUrl('/deliverables'), ({ request }) => {
        expect(new URL(request.url).searchParams.get('project_id')).toBe('7');
        return HttpResponse.json(page([DELIVERABLE]));
      }),
    );
    renderWithApp(routes(), { route: '/projects/WEB' });
    expect(await screen.findByText('1 of 2 deliverables completed')).toBeInTheDocument();
    expect(screen.getByText('$120,000')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /deliverables/i }));
    expect(await screen.findByText('Design system')).toBeInTheDocument();
    expect(screen.getByText(/overdue/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add deliverable' })).toBeInTheDocument();
  });

  it('hides edit and delete without permission, and reports missing projects', async () => {
    server.use(
      ...sessionHandlers('viewer'),
      http.get(apiUrl('/projects/WEB'), () => HttpResponse.json({ ...PROJECT, permissions: { update: false, delete: false, editable_fields: [] } })),
      http.get(apiUrl('/projects/NOPE'), () => HttpResponse.json({ error: { code: 'not_found', message: 'x' } }, { status: 404 })),
    );
    const { unmount } = renderWithApp(routes(), { route: '/projects/WEB' });
    expect(await screen.findByText('Website relaunch', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    unmount();
    renderWithApp(routes(), { route: '/projects/NOPE' });
    expect(await screen.findByText(/does not exist or is not visible/)).toBeInTheDocument();
  });

  it('edits and deletes a project', async () => {
    let update;
    server.use(
      ...sessionHandlers('admin'), ...lookups(),
      http.get(apiUrl('/projects/WEB'), () => HttpResponse.json(PROJECT)),
      http.put(apiUrl('/projects/7'), async ({ request }) => { update = await request.json(); return HttpResponse.json(PROJECT); }),
      http.delete(apiUrl('/projects/7'), () => new HttpResponse(null, { status: 204 })),
      http.get(apiUrl('/projects'), () => HttpResponse.json(page([]))),
    );
    renderWithApp(routes(), { route: '/projects/WEB' });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText(/^name/i));
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'Website 2.0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toEqual({ name: 'Website 2.0' }));
    expect(await screen.findByText('Project updated')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
  });
});

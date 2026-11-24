import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import DeliverableDetailPage from './DeliverableDetailPage';
import DeliverablesPage from './DeliverablesPage';
import { DELIVERABLE, page, sessionHandlers } from '../../test/fixtures';
import { renderWithApp } from '../../test/render';
import { apiUrl, server } from '../../test/server';

const PEOPLE = [{ id: 1, name: 'Pat team member' }, { id: 2, name: 'Alice Morgan' }];
const COMMENT = {
  id: 5, deliverable_id: 11, author_id: 2, author_name: 'Alice Morgan', body: 'Please add dark mode tokens.',
  created_at: '2026-01-03T09:00:00Z', updated_at: '2026-01-03T09:00:00Z', edited: false,
  permissions: { update: false, delete: false },
};
const OPEN_LINK = { id: 3, type: 'is_blocked_by', deliverable_id: 9, key: 'WEB-1', name: 'Information architecture', status: 'in_progress', priority: 'high' };

function routes() {
  return (
    <Routes>
      <Route path="/deliverables" element={<DeliverablesPage />} />
      <Route path="/deliverables/:id" element={<DeliverableDetailPage />} />
      <Route path="/projects/:id" element={<p>Project page</p>} />
    </Routes>
  );
}

/** Handlers for the page's supporting data; `state` lets tests mutate comments and links. */
function support(state = { comments: [COMMENT], links: [OPEN_LINK] }) {
  return [
    http.get(apiUrl('/users'), () => HttpResponse.json(page(PEOPLE))),
    http.get(apiUrl('/deliverables/WEB-3/comments'), () => HttpResponse.json({ data: state.comments, total: state.comments.length })),
    http.get(apiUrl('/deliverables/WEB-3/links'), () => HttpResponse.json({ data: state.links })),
    http.post(apiUrl('/deliverables/WEB-3/comments'), async ({ request }) => {
      const { body } = await request.json();
      const created = { ...COMMENT, id: 6, author_id: 1, author_name: 'Pat team member', body, permissions: { update: true, delete: true } };
      state.comments = [...state.comments, created];
      return HttpResponse.json(created, { status: 201 });
    }),
  ];
}

describe('Deliverable detail (Jira-style)', () => {
  it('opens from the list; owner updates status, completes and comments', async () => {
    const puts = [];
    server.use(
      ...sessionHandlers('team_member'), ...support(),
      http.get(apiUrl('/deliverables'), () => HttpResponse.json(page([DELIVERABLE]))),
      http.get(apiUrl('/deliverables/WEB-3'), () => HttpResponse.json(DELIVERABLE)),
      http.put(apiUrl('/deliverables/11'), async ({ request }) => {
        const changes = await request.json();
        puts.push(changes);
        return HttpResponse.json({ ...DELIVERABLE, ...changes, ...(changes.status === 'completed' && { progress_pct: 100, is_overdue: false }) });
      }),
    );
    renderWithApp(routes(), { route: '/deliverables' });
    expect(await screen.findByText('WEB-3')).toBeInTheDocument(); // key column
    await userEvent.click(screen.getByText('Design system'));

    expect(await screen.findByRole('heading', { level: 1, name: 'Design system' })).toBeInTheDocument();
    expect(screen.getByText(/Overdue: this was due on/)).toBeInTheDocument();
    expect(screen.getByText('Please add dark mode tokens.')).toBeInTheDocument();
    expect(screen.getByText('WEB-1')).toBeInTheDocument(); // linked work item
    expect(screen.getByText('Is blocked by')).toBeInTheDocument();
    // Owners may only change status and progress; everything else is read-only text.
    expect(screen.queryByRole('button', { name: 'Edit description' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Assignee' })).not.toBeInTheDocument();
    expect(screen.getByText('Alice Morgan', { selector: 'p, div' })).toBeInTheDocument(); // reporter
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link work item' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Blocked' }));
    await waitFor(() => expect(puts).toEqual([{ status: 'blocked' }]));
    expect(await screen.findByText(/Blocked: this deliverable/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    await waitFor(() => expect(puts.at(-1)).toEqual({ status: 'completed' }));
    expect(await screen.findByText('Marked as completed')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark complete' })).not.toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Add a comment'), 'Tokens published');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(await screen.findByText('Tokens published')).toBeInTheDocument();
  });

  it('shows the server reason when completion is refused', async () => {
    server.use(
      ...sessionHandlers('team_member'), ...support(),
      http.get(apiUrl('/deliverables/WEB-3'), () => HttpResponse.json(DELIVERABLE)),
      http.put(apiUrl('/deliverables/11'), () => HttpResponse.json(
        { error: { code: 'validation_error', message: 'Request validation failed', details: { status: 'cannot complete while blocked by WEB-1' } } },
        { status: 400 },
      )),
    );
    renderWithApp(routes(), { route: '/deliverables/WEB-3' });
    await userEvent.click(await screen.findByRole('button', { name: 'Mark complete' }));
    expect(await screen.findByText('cannot complete while blocked by WEB-1')).toBeInTheDocument();
  });

  it('is read-only for viewers and reports missing items', async () => {
    const readOnly = { ...DELIVERABLE, permissions: { update: false, delete: false, editable_fields: [] } };
    server.use(
      ...sessionHandlers('viewer'), ...support(),
      http.get(apiUrl('/deliverables/WEB-3'), () => HttpResponse.json(readOnly)),
      http.get(apiUrl('/deliverables/NOPE-9'), () => HttpResponse.json({ error: { code: 'not_found', message: 'x' } }, { status: 404 })),
    );
    const { unmount } = renderWithApp(routes(), { route: '/deliverables/WEB-3' });
    expect(await screen.findByText('Please add dark mode tokens.')).toBeInTheDocument();
    for (const name of ['Mark complete', 'Delete', 'Link work item', 'Comment']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Add a comment')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('No description yet.')).toBeInTheDocument();
    unmount();
    renderWithApp(routes(), { route: '/deliverables/NOPE-9' });
    expect(await screen.findByText(/does not exist or is not visible/)).toBeInTheDocument();
  });

  it('lets the project manager edit fields in place, link work items and delete', async () => {
    const managed = { ...DELIVERABLE, project_manager_id: 1, permissions: { update: true, delete: true, editable_fields: null } };
    const puts = [];
    let linked;
    server.use(
      ...sessionHandlers('project_manager'), ...support(),
      http.get(apiUrl('/deliverables/WEB-3'), () => HttpResponse.json(managed)),
      http.put(apiUrl('/deliverables/11'), async ({ request }) => {
        const changes = await request.json();
        puts.push(changes);
        return HttpResponse.json({ ...managed, ...changes });
      }),
      http.post(apiUrl('/deliverables/WEB-3/links'), async ({ request }) => {
        linked = await request.json();
        return HttpResponse.json({ id: 8, type: 'blocks', deliverable_id: 12, key: 'WEB-9', name: 'Launch', status: 'not_started' }, { status: 201 });
      }),
      http.delete(apiUrl('/deliverables/11'), () => new HttpResponse(null, { status: 204 })),
    );
    renderWithApp(routes(), { route: '/deliverables/WEB-3' });

    await userEvent.click(await screen.findByRole('button', { name: 'Edit description' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Description' }), 'Tokens and components');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toEqual([{ description: 'Tokens and components' }]));
    expect(await screen.findByText('Tokens and components')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox', { name: 'Assignee' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Alice Morgan' }));
    await waitFor(() => expect(puts.at(-1)).toEqual({ owner_id: 2 }));

    await userEvent.click(screen.getByRole('button', { name: 'Link work item' }));
    await userEvent.type(screen.getByLabelText(/work item key/i), 'web-9');
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(linked).toEqual({ type: 'blocks', target: 'WEB-9' }));

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Project page')).toBeInTheDocument();
  });
});

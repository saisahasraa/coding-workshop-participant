import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import DeliverableDetailPage from './DeliverableDetailPage';
import { DELIVERABLE, FILE, page, sessionHandlers } from '../../test/fixtures';
import { renderWithApp } from '../../test/render';
import { apiUrl, server } from '../../test/server';

const PEOPLE = [{ id: 1, name: 'Pat team member' }, { id: 2, name: 'Alice Morgan' }, { id: 5, name: 'Dan Okafor' }];
const comment = (extra) => ({
  id: 5, deliverable_id: 11, author_id: 2, author_name: 'Alice Morgan', body: 'First', created_at: '2026-01-03T09:00:00Z',
  updated_at: '2026-01-03T09:00:00Z', edited: false, mentions: [], permissions: { update: false, delete: false }, ...extra,
});
const routes = () => <Routes><Route path="/deliverables/:id" element={<DeliverableDetailPage />} /></Routes>;

/** Page data; `state` is shared so a test can see what was posted. Extra handlers come first to override. */
function handlers(state, extra = []) {
  return [
    ...extra,
    http.get(apiUrl('/deliverables/WEB-3'), () => HttpResponse.json(DELIVERABLE)),
    http.get(apiUrl('/users'), () => HttpResponse.json(page(PEOPLE))),
    http.get(apiUrl('/deliverables/WEB-3/links'), () => HttpResponse.json({ data: [] })),
    http.get(apiUrl('/deliverables/WEB-3/comments'), () => HttpResponse.json({ data: state.comments, total: state.comments.length, can_comment: state.canComment ?? true })),
    http.get(apiUrl('/deliverables/WEB-3/attachments'), () => HttpResponse.json({ data: state.files, total: state.files.length, max_size_mb: 1, enabled: state.enabled ?? true })),
    http.get(apiUrl('/attachments/41/download'), () => HttpResponse.json({ url: 'https://files.test/wireframe.png', filename: 'wireframe.png' })),
    http.post(apiUrl('/deliverables/WEB-3/comments'), async ({ request }) => {
      state.posted = await request.json();
      state.comments = [...state.comments, comment({ id: 6, body: state.posted.body, mentions: PEOPLE.filter((p) => state.posted.mentions.includes(p.id)) })];
      return HttpResponse.json(state.comments.at(-1), { status: 201 });
    }),
  ];
}

describe('Comments with mentions and files', () => {
  it('offers people after @, inserts the pick and sends who was mentioned', async () => {
    const state = { comments: [], files: [] };
    server.use(...sessionHandlers('team_member'), ...handlers(state));
    renderWithApp(routes(), { route: '/deliverables/WEB-3' });
    const box = await screen.findByLabelText('Add a comment');
    await userEvent.type(box, 'Please check @da');
    const list = await screen.findByRole('menu', { name: 'People to mention' });
    expect(within(list).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['DODan Okafor']);
    await userEvent.keyboard('{Enter}');                                  // Enter picks instead of submitting
    expect(box).toHaveValue('Please check @Dan Okafor ');
    await userEvent.type(box, 'today');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(state.posted).toEqual({ body: 'Please check @Dan Okafor today', mentions: [5] }));
    const mention = await screen.findByText('@Dan Okafor');
    expect(mention.tagName).toBe('SPAN');                                 // highlighted in the saved comment
    expect(box).toHaveValue('');
  });

  it('lets arrow keys choose and Escape dismiss; a deleted mention is not sent', async () => {
    const state = { comments: [], files: [] };
    server.use(...sessionHandlers('team_member'), ...handlers(state));
    renderWithApp(routes(), { route: '/deliverables/WEB-3' });
    const box = await screen.findByLabelText('Add a comment');
    await userEvent.type(box, '@a');
    await screen.findByRole('menu', { name: 'People to mention' });
    await userEvent.keyboard('{ArrowDown}{Enter}');                       // second match
    expect(box.value).toMatch(/^@(Alice Morgan|Dan Okafor|Pat team member) $/);
    await userEvent.clear(box);
    await userEvent.type(box, 'plain @p');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'People to mention' })).not.toBeInTheDocument());
    await userEvent.clear(box);
    await userEvent.type(box, 'no one');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(state.posted).toEqual({ body: 'no one', mentions: [] }));
  });

  it('uploads a file straight to storage and places it at the cursor', async () => {
    const state = { comments: [], files: [] };
    const sent = [];
    server.use(...sessionHandlers('team_member'), ...handlers(state, [
      http.post(apiUrl('/deliverables/WEB-3/attachments'), async ({ request }) => {
        sent.push(await request.json());
        state.files = [FILE];
        return HttpResponse.json({ ...FILE, upload: { url: 'https://files.test/upload', method: 'PUT', headers: { 'Content-Type': 'image/png' } } }, { status: 201 });
      }),
      http.put('https://files.test/upload', async ({ request }) => { sent.push(['PUT', request.headers.get('content-type'), (await request.arrayBuffer()).byteLength]); return new HttpResponse(null, { status: 200 }); }),
    ]));
    renderWithApp(routes(), { route: '/deliverables/WEB-3' });
    const box = await screen.findByLabelText('Add a comment');
    await userEvent.type(box, 'before after');
    box.setSelectionRange(6, 6);
    await userEvent.click(box);                                            // caret between the two words
    box.setSelectionRange(6, 6);
    box.dispatchEvent(new Event('select', { bubbles: true }));
    await userEvent.upload(screen.getByLabelText('Choose files to attach'), new File(['12345'], 'wireframe.png', { type: 'image/png' }));
    await waitFor(() => expect(box).toHaveValue('before [wireframe.png](attachment:41) after'));
    expect(sent[0]).toEqual({ filename: 'wireframe.png', content_type: 'image/png', size_bytes: 5 });
    expect(sent[1]).toEqual(['PUT', 'image/png', 5]);
    const panel = screen.getByRole('region', { name: /Artifacts/ });
    expect(await within(panel).findByRole('button', { name: 'wireframe.png' })).toBeInTheDocument();
  });

  it('refuses files over the limit and cleans up a failed upload', async () => {
    const state = { comments: [], files: [] };
    let removed = false;
    server.use(...sessionHandlers('team_member'), ...handlers(state, [
      http.post(apiUrl('/deliverables/WEB-3/attachments'), () => HttpResponse.json({ ...FILE, upload: { url: 'https://files.test/broken', method: 'PUT', headers: {} } }, { status: 201 })),
      http.put('https://files.test/broken', () => new HttpResponse(null, { status: 403 })),
      http.delete(apiUrl('/attachments/41'), () => { removed = true; return new HttpResponse(null, { status: 204 }); }),
    ]));
    renderWithApp(routes(), { route: '/deliverables/WEB-3' });
    const picker = await screen.findByLabelText('Choose files to attach');
    await userEvent.upload(picker, new File([new Uint8Array(2 * 1024 * 1024)], 'huge.zip', { type: 'application/zip' }));
    expect(await screen.findByText('huge.zip is larger than 1 MB')).toBeInTheDocument();
    await userEvent.upload(picker, new File(['x'], 'small.txt', { type: 'text/plain' }));
    expect(await screen.findByText(/small.txt: Upload failed \(403\)/)).toBeInTheDocument();
    await waitFor(() => expect(removed).toBe(true));
    expect(screen.getByLabelText('Add a comment')).toHaveValue('');
  });

  it('shows images in place, files as chips, and removed files as removed', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const state = { files: [FILE], comments: [comment({ body: 'Look [wireframe.png](attachment:41) and [old.pdf](attachment:99)' })] };
    server.use(...sessionHandlers('viewer'), ...handlers({ ...state, canComment: false }));
    renderWithApp(routes(), { route: '/deliverables/WEB-3' });
    const image = await screen.findByRole('img', { name: 'wireframe.png' });
    expect(image).toHaveAttribute('src', 'https://files.test/wireframe.png');
    expect(screen.getByText('old.pdf (removed)')).toBeInTheDocument();
    expect(screen.getByText(/You can read this conversation but not add to it/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open image wireframe.png' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://files.test/wireframe.png', '_blank', 'noopener'));
    open.mockRestore();
  });
});

describe('Artifacts panel', () => {
  it('lists every file of the deliverable and removes one', async () => {
    const state = { comments: [], files: [FILE, { ...FILE, id: 42, filename: 'plan.docx', is_image: false, permissions: { delete: false } }] };
    let removed = null;
    server.use(...sessionHandlers('team_member'), ...handlers(state, [
      http.delete(apiUrl('/attachments/:id'), ({ params }) => { removed = params.id; state.files = state.files.filter((f) => String(f.id) !== params.id); return new HttpResponse(null, { status: 204 }); }),
    ]));
    renderWithApp(routes(), { route: '/deliverables/WEB-3' });
    const panel = await screen.findByRole('region', { name: 'Artifacts (2)' });
    expect(within(panel).getAllByText(/200 KB · Alice Morgan/)).toHaveLength(2);
    expect(within(panel).queryByRole('button', { name: 'Remove plan.docx' })).not.toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Remove wireframe.png' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /confirm|remove|delete/i }));
    await waitFor(() => expect(removed).toBe('41'));
    expect(await screen.findByRole('region', { name: 'Artifacts (1)' })).toBeInTheDocument();
  });

  it('says when file storage is not available', async () => {
    server.use(...sessionHandlers('team_member'), ...handlers({ comments: [], files: [], enabled: false }));
    renderWithApp(routes(), { route: '/deliverables/WEB-3' });
    expect(await screen.findByText('File storage is not set up in this environment.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Attach' })).toBeDisabled();   // the composer loads with the comments
  });
});

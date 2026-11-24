import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import GlobalSearch from './GlobalSearch';
import { SEARCH, sessionHandlers } from '../test/fixtures';
import { renderWithApp } from '../test/render';
import { apiUrl, server } from '../test/server';

function Where() {
  const location = useLocation();
  return <p>at {location.pathname}{location.search}</p>;
}

const app = () => (
  <Routes>
    <Route path="*" element={<><GlobalSearch /><Where /></>} />
  </Routes>
);

describe('Global search', () => {
  it('finds projects, deliverables and people as you type, and opens the pick', async () => {
    const queries = [];
    server.use(...sessionHandlers('viewer'), http.get(apiUrl('/search'), ({ request }) => {
      queries.push(new URL(request.url).searchParams.get('q'));
      return HttpResponse.json(SEARCH);
    }));
    renderWithApp(app());
    const box = await screen.findByRole('combobox', { name: 'Search projects, deliverables and people' });
    await userEvent.type(box, 'p');
    expect(queries).toEqual([]);                                  // too short: nothing is asked
    await userEvent.type(box, 'ay');
    expect(await screen.findByText('Payments platform')).toBeInTheDocument();
    expect(queries).toEqual(['pay']);                             // debounced into one call
    for (const heading of ['Projects', 'Deliverables', 'People']) expect(screen.getByText(heading)).toBeInTheDocument();
    expect(screen.getByText('Fraud rules engine')).toBeInTheDocument();
    expect(screen.getByText('Backend Engineer')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Fraud rules engine'));
    expect(await screen.findByText('at /deliverables/PAY-2')).toBeInTheDocument();
    expect(box).toHaveValue('');
  });

  it.each([['Payments platform', '/projects/PAY'], ['Backend Engineer', '/deliverables?person=5']])('opens %s', async (text, path) => {
    server.use(...sessionHandlers('viewer'), http.get(apiUrl('/search'), () => HttpResponse.json(SEARCH)));
    renderWithApp(app());
    await userEvent.type(await screen.findByRole('combobox'), 'pay');
    await userEvent.click(await screen.findByText(text));
    expect(await screen.findByText(`at ${path}`)).toBeInTheDocument();
  });

  it('jumps to the search box with the / key', async () => {
    server.use(...sessionHandlers('viewer'));
    renderWithApp(app());
    const box = await screen.findByRole('combobox');
    expect(box).not.toHaveFocus();
    await userEvent.keyboard('/');
    expect(box).toHaveFocus();
    await userEvent.keyboard('a/b');
    expect(box).toHaveValue('a/b');                               // typing a slash inside a field is just a slash
  });

  it('says when nothing matches or the search fails', async () => {
    server.use(...sessionHandlers('viewer'), http.get(apiUrl('/search'), () => HttpResponse.json({ q: 'zzz', projects: [], deliverables: [], people: [] })));
    const { unmount } = renderWithApp(app());
    await userEvent.type(await screen.findByRole('combobox'), 'zzz');
    expect(await screen.findByText('Nothing found')).toBeInTheDocument();
    unmount();

    server.use(http.get(apiUrl('/search'), () => HttpResponse.json({ error: { code: 'internal_error', message: 'Boom' } }, { status: 500 })));
    renderWithApp(app());
    await userEvent.type(await screen.findByRole('combobox'), 'zzz');
    await waitFor(() => expect(screen.getByText('Nothing found')).toBeInTheDocument());
  });
});

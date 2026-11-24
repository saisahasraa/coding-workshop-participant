import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import NotificationBell from './NotificationBell';
import { NOTIFICATIONS, sessionHandlers } from '../test/fixtures';
import { renderWithApp } from '../test/render';
import { apiUrl, server } from '../test/server';

function Where() {
  return <p>at {useLocation().pathname}</p>;
}
const app = () => <Routes><Route path="*" element={<><NotificationBell /><Where /></>} /></Routes>;

describe('Notification bell', () => {
  it('shows the unread count, lists what happened and opens the item', async () => {
    const read = [];
    let inbox = NOTIFICATIONS;
    server.use(...sessionHandlers('team_member'),
      http.get(apiUrl('/notifications'), () => HttpResponse.json(inbox)),
      http.post(apiUrl('/notifications/read'), async ({ request }) => {
        read.push(await request.json());
        inbox = { unread: 1, data: NOTIFICATIONS.data.map((n) => (n.id === 9 ? { ...n, read_at: '2026-03-03T09:00:00Z' } : n)) };
        return new HttpResponse(null, { status: 204 });
      }));
    renderWithApp(app());
    const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    await userEvent.click(bell);
    const items = await screen.findAllByRole('button', { name: /mentioned you|assigned you|moved project/ });
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText(/unread/)).toBeInTheDocument();
    expect(within(items[2]).queryByText(/unread/)).not.toBeInTheDocument();
    await userEvent.click(items[0]);
    expect(await screen.findByText('at /deliverables/WEB-3')).toBeInTheDocument();
    await waitFor(() => expect(read).toEqual([{ ids: [9] }]));
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument();
  });

  it('marks everything read, and is calm when there is nothing or the server fails', async () => {
    const read = [];
    let inbox = NOTIFICATIONS;
    server.use(...sessionHandlers('team_member'),
      http.get(apiUrl('/notifications'), () => HttpResponse.json(inbox)),
      http.post(apiUrl('/notifications/read'), async ({ request }) => { read.push(await request.json()); inbox = { unread: 0, data: [] }; return new HttpResponse(null, { status: 204 }); }));
    const { unmount } = renderWithApp(app());
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(read).toEqual([{}]));
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
    unmount();

    server.use(http.get(apiUrl('/notifications'), () => HttpResponse.json({ error: { code: 'internal_error', message: 'Boom' } }, { status: 500 })));
    renderWithApp(app());
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });
});

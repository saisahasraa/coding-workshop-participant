import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import ProfilePage from './ProfilePage';
import { sessionHandlers, userFor } from '../../test/fixtures';
import { renderWithApp } from '../../test/render';
import { apiUrl, server } from '../../test/server';
import { getAccessToken } from '../../auth/tokenStore';

describe('Profile', () => {
  it('changes the password and keeps this session', async () => {
    let body;
    server.use(...sessionHandlers('team_member'), http.put(apiUrl('/auth/me'), async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ user: userFor('team_member'), tokens: { access_token: 'fresh', refresh_token: 'r9' } });
    }));
    renderWithApp(<ProfilePage />, { route: '/profile' });
    await userEvent.click(await screen.findByRole('button', { name: 'Change password' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/current password/i), 'OldPass#1');
    await userEvent.type(within(dialog).getByLabelText(/new password/i), 'NewPass#12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(body).toEqual({ current_password: 'OldPass#1', password: 'NewPass#12' }));
    expect(await screen.findByText('Password changed')).toBeInTheDocument();
    expect(getAccessToken()).toBe('fresh');
  });

  it('signs out everywhere', async () => {
    let revoked = false;
    server.use(...sessionHandlers('viewer'), http.post(apiUrl('/auth/logout-all'), () => { revoked = true; return new HttpResponse(null, { status: 204 }); }));
    renderWithApp(<ProfilePage />, { route: '/profile' });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
    await waitFor(() => expect(revoked).toBe(true));
    expect(window.localStorage.getItem('acme.refreshToken')).toBeNull();
  });

  it('edits the name', async () => {
    let body;
    server.use(...sessionHandlers('viewer'), http.put(apiUrl('/auth/me'), async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ user: userFor('viewer') });
    }));
    renderWithApp(<ProfilePage />, { route: '/profile' });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit name' }));
    const input = within(await screen.findByRole('dialog')).getByLabelText(/full name/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).toEqual({ name: 'Renamed' }));
  });
});

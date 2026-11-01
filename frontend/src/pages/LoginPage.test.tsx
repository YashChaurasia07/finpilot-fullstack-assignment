import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { RequireAuth } from '../auth/RequireAuth';
import { LoginPage } from './LoginPage';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const unauthenticated = { success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue', requestId: 'r' } };
const viewer = { success: true, data: { user: { id: 2, email: 'person@example.test', fullName: 'Demo Viewer', role: 'VIEWER' } } };

function renderApp(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, initial = '/customers') {
  vi.stubGlobal('fetch', vi.fn((url: URL, init?: RequestInit) => fetchImpl(String(url), init)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/customers" element={<RequireAuth><h1>Customer list</h1></RequireAuth>} />
            <Route path="/admin" element={<RequireAuth role="ADMIN"><h1>Admin area</h1></RequireAuth>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('authentication flow', () => {
  it('sends a signed-out visitor to the sign-in page', async () => {
    renderApp(async () => json(401, unauthenticated));
    expect(await screen.findByRole('heading', { name: 'Sign in to FinPilot' })).toBeInTheDocument();
  });

  it('shows the server’s message for a wrong password and keeps the user on the form', async () => {
    renderApp(async (url) => (url.endsWith('/auth/login') ? json(401, { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password', requestId: 'r' } }) : json(401, unauthenticated)));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'person@example.test');
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.getByRole('heading', { name: 'Sign in to FinPilot' })).toBeInTheDocument();
  });

  it('tells the user when the server cannot be reached', async () => {
    renderApp(async (url) => {
      if (url.endsWith('/auth/login')) throw new TypeError('Failed to fetch');
      return json(401, unauthenticated);
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'person@example.test');
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot reach the server/i);
  });

  it('signs in and lands on the page that was asked for', async () => {
    let signedIn = false;
    renderApp(async (url) => {
      if (url.endsWith('/auth/login')) {
        signedIn = true;
        return json(200, viewer);
      }
      return signedIn ? json(200, viewer) : json(401, unauthenticated);
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'person@example.test');
    await user.type(screen.getByLabelText('Password'), 'dummy-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Customer list' })).toBeInTheDocument();
  });

  it('lets a signed-in viewer into normal pages but shows "no access" for admin pages', async () => {
    renderApp(async () => json(200, viewer), '/admin');
    expect(await screen.findByText('You don’t have access to this page')).toBeInTheDocument();
    expect(screen.queryByText('Admin area')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('link', { name: 'Back to customers' })).toBeInTheDocument());
  });
});

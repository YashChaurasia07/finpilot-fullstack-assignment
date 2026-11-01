import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ApiError } from '../api/client';
import { useLogin } from '../api/hooks';
import { useAuth } from '../auth/context';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/** Only ever return to a path inside this app. */
const safePath = (value: unknown): string => (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/customers');

export function LoginPage() {
  useDocumentTitle('Sign in');
  const { user } = useAuth();
  const login = useLogin();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (user) return <Navigate to={safePath((location.state as { from?: string } | null)?.from)} replace />;

  function submit(e: FormEvent) {
    e.preventDefault();
    login.mutate({ email: email.trim(), password });
  }

  const error = login.error instanceof ApiError ? login.error : login.error ? new ApiError(0, 'UNKNOWN', 'Something went wrong. Please try again.') : null;

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-xl bg-indigo-600 text-xl font-semibold text-white" aria-hidden="true">
            F
          </span>
          <h1 className="mt-3 text-2xl font-semibold">Sign in to FinPilot</h1>
          <p className="mt-1 text-sm text-slate-600">Investment portfolio &amp; goal monitoring</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6" noValidate={false}>
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input id="email" type="email" className="input" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <input id="password" type="password" className="input" autoComplete="current-password" required maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error.message}
            </p>
          )}
          <button type="submit" className="btn btn-primary w-full" disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-600">Demo sign-in details: see the README.</p>
      </div>
    </main>
  );
}

import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import type { Role } from '../api/types';
import { Spinner } from '../components/Spinner';
import { useAuth } from './context';

/** Gate for pages. Signed out -> sign-in screen (and back afterwards); wrong role -> a clear "not allowed". */
export function RequireAuth({ role, children }: { role?: Role; children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <Spinner label="Checking your session…" className="py-24" />;
  if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  if (role && user.role !== role) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center" role="alert">
        <h1 className="text-xl font-semibold">You don’t have access to this page</h1>
        <p className="mt-2 text-slate-600">This area is for administrators. You are signed in as {user.email} ({user.role}).</p>
        <Link to="/customers" className="btn btn-primary mt-6">
          Back to customers
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}

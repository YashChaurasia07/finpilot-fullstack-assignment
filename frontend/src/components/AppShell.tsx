import { Link, NavLink, Outlet } from 'react-router';
import { useLogout } from '../api/hooks';
import { useAuth } from '../auth/context';
import { Badge } from './Badge';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'}`;

export function AppShell() {
  const { user } = useAuth();
  const logout = useLogout();

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg">
        Skip to main content
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link to="/customers" className="flex items-center gap-2 text-lg font-semibold">
              <span className="grid size-7 place-items-center rounded-lg bg-indigo-600 text-sm text-white" aria-hidden="true">
                F
              </span>
              FinPilot
            </Link>
            <nav aria-label="Main" className="flex gap-1">
              <NavLink to="/customers" className={navClass}>
                Customers
              </NavLink>
              {user?.role === 'ADMIN' && (
                <NavLink to="/admin/import" className={navClass}>
                  Data import
                </NavLink>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-700 sm:inline">{user?.email}</span>
            {user && <Badge tone={user.role === 'ADMIN' ? 'indigo' : 'slate'}>{user.role}</Badge>}
            <button type="button" className="btn btn-secondary py-1.5" onClick={() => logout.mutate()} disabled={logout.isPending}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-600">FinPilot · synthetic data for assessment only</footer>
    </div>
  );
}

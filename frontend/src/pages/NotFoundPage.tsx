import { Link } from 'react-router';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-slate-600">The page you are looking for does not exist or has moved.</p>
      <Link to="/customers" className="btn btn-primary mt-6">
        Go to customers
      </Link>
    </div>
  );
}

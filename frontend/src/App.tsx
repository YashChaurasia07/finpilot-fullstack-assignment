import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth } from './auth/RequireAuth';
import { AppShell } from './components/AppShell';
import { AdminImportPage } from './pages/AdminImportPage';
import { CustomerLayout } from './pages/CustomerLayout';
import { CustomersPage } from './pages/CustomersPage';
import { GoalsTab } from './pages/GoalsTab';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OverviewTab } from './pages/OverviewTab';
import { PortfolioTab } from './pages/PortfolioTab';
import { TransactionsTab } from './pages/TransactionsTab';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/customers" replace />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:customerId" element={<CustomerLayout />}>
          <Route index element={<OverviewTab />} />
          <Route path="portfolio" element={<PortfolioTab />} />
          <Route path="transactions" element={<TransactionsTab />} />
          <Route path="goals" element={<GoalsTab />} />
        </Route>
        <Route
          path="admin/import"
          element={
            <RequireAuth role="ADMIN">
              <AdminImportPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

import { createContext, useContext } from 'react';
import type { User } from '../api/types';

export interface AuthState {
  /** undefined while the first /auth/me check is running, null when signed out. */
  user: User | null | undefined;
  isLoading: boolean;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

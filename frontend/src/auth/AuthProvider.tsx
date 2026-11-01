import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { setUnauthorizedHandler } from '../api/client';
import { useMe } from '../api/hooks';
import { AuthContext } from './context';

/** Session state comes from /auth/me (the cookie is httpOnly, so the page cannot read it directly). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useMe();
  const qc = useQueryClient();

  // If the API ever answers 401 mid-session (expired cookie), drop to the sign-in screen instead of showing errors.
  useEffect(() => {
    setUnauthorizedHandler(() => qc.setQueryData(['me'], null));
    return () => setUnauthorizedHandler(undefined);
  }, [qc]);

  return <AuthContext value={{ user, isLoading }}>{children}</AuthContext>;
}

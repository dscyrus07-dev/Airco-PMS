/**
 * Session store — owns auth status, tokens (via SecureStore), and the
 * current user/company. Everything else is server state fetched per screen;
 * the app deliberately keeps no global collection cache.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { configureApi } from '@/services/api';
import {
  clearTokens,
  fetchMe,
  getAccessToken,
  getRefreshToken,
  login as apiLogin,
  logout as apiLogout,
  refreshAccessToken,
  saveTokens,
} from '@/services/auth';
import type { Company, User } from '@/types/api';

export type SessionStatus = 'booting' | 'signedOut' | 'signedIn';

interface SessionState {
  status: SessionStatus;
  user: User | null;
  company: Company | null;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

let refreshInFlight: Promise<boolean> | null = null;
const singleFlightRefresh = (): Promise<boolean> => {
  refreshInFlight ??= refreshAccessToken().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
};

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('booting');
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<Company | null>(null);

  const signOut = useCallback(async () => {
    await apiLogout();
    setUser(null);
    setCompany(null);
    setStatus('signedOut');
  }, []);

  /** Expired-session path — local clear only, no server call needed. */
  const expireSession = useCallback(() => {
    void clearTokens();
    setUser(null);
    setCompany(null);
    setStatus('signedOut');
  }, []);

  useEffect(() => {
    configureApi({
      getAccessToken,
      doRefresh: singleFlightRefresh,
      onSessionExpired: expireSession,
    });

    const boot = async () => {
      try {
        const hasAccess = !!(await getAccessToken());
        const hasRefresh = !!(await getRefreshToken());
        if (!hasAccess && !hasRefresh) {
          setStatus('signedOut');
          return;
        }
        if (!hasAccess && hasRefresh && !(await singleFlightRefresh())) {
          expireSession();
          return;
        }
        const me = await fetchMe();
        setUser(me.user);
        setCompany(me.company);
        setStatus('signedIn');
      } catch {
        // A dead network at boot is not an expired session — keep tokens and
        // let the first real request retry the refresh path.
        expireSession();
      }
    };
    void boot();
  }, [expireSession]);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const res = await apiLogin(identifier.trim(), password);
    await saveTokens(res.access_token, res.refresh_token);
    setUser(res.user);
    setCompany(res.company);
    setStatus('signedIn');
  }, []);

  const refreshProfile = useCallback(async () => {
    const me = await fetchMe();
    setUser(me.user);
    setCompany(me.company);
  }, []);

  const value = useMemo(
    () => ({ status, user, company, signIn, signOut, refreshProfile }),
    [status, user, company, signIn, signOut, refreshProfile]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = (): SessionState => {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
};

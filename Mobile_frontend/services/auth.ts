/**
 * Authentication service — login/refresh/logout/me against /api/v1/auth.
 * Tokens live in Expo SecureStore (never AsyncStorage).
 */

import * as SecureStore from 'expo-secure-store';

import { apiFetch } from '@/services/api';
import type { AuthResponse, MeResponse } from '@/types/api';

const ACCESS_KEY = 'airos.access_token';
const REFRESH_KEY = 'airos.refresh_token';
const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const getAccessToken = (): Promise<string | null> =>
  SecureStore.getItemAsync(ACCESS_KEY, SECURE_OPTS).catch(() => null);

export const getRefreshToken = (): Promise<string | null> =>
  SecureStore.getItemAsync(REFRESH_KEY, SECURE_OPTS).catch(() => null);

export const saveTokens = async (access: string, refresh: string): Promise<void> => {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, access, SECURE_OPTS),
    SecureStore.setItemAsync(REFRESH_KEY, refresh, SECURE_OPTS),
  ]);
};

export const clearTokens = async (): Promise<void> => {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY, SECURE_OPTS).catch(() => undefined),
    SecureStore.deleteItemAsync(REFRESH_KEY, SECURE_OPTS).catch(() => undefined),
  ]);
};

export const login = (identifier: string, password: string): Promise<AuthResponse> =>
  apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    auth: false,
    body: { identifier, password },
  });

/**
 * Exchange the stored refresh token for a new access token.
 * Returns false when the refresh is rejected — caller signs out.
 */
export const refreshAccessToken = async (): Promise<boolean> => {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return false;
  try {
    const data = await apiFetch<{ access_token: string }>('/auth/refresh', {
      method: 'POST',
      auth: false,
      body: { refresh_token: refreshToken },
    });
    if (!data?.access_token) return false;
    await SecureStore.setItemAsync(ACCESS_KEY, data.access_token, SECURE_OPTS);
    return true;
  } catch {
    return false;
  }
};

/** Best-effort server-side revocation — always clears local tokens. */
export const logout = async (): Promise<void> => {
  const refreshToken = await getRefreshToken();
  try {
    if (refreshToken) {
      await apiFetch('/auth/logout', {
        method: 'POST',
        auth: false,
        body: { refresh_token: refreshToken },
      });
    }
  } catch {
    /* revocation is best-effort — tokens are cleared regardless */
  }
  await clearTokens();
};

export const fetchMe = (): Promise<MeResponse> => apiFetch<MeResponse>('/auth/me');

export const updateMe = (payload: {
  name?: string;
  phone?: string;
  email?: string;
}): Promise<void> => apiFetch('/auth/me', { method: 'PATCH', body: payload });

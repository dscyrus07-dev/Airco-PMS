import {
  apiFetch,
  setAuthToken,
  setRefreshToken,
  clearAuthToken,
  getRefreshToken,
} from './client';
import {
  LoginRequest,
  AuthResponse,
  MeResponse,
  RegisterCompanyRequest,
  UpdateProfileRequest,
} from './types';
import { AuthUser } from '../types';

/**
 * Authentication endpoints — POST /auth/login, /auth/signup, /auth/logout,
 * /auth/refresh; GET+PATCH /auth/me. Contract: /API.md.
 */

const storeSession = (res: AuthResponse): AuthResponse => {
  setAuthToken(res.access_token);
  setRefreshToken(res.refresh_token);
  return res;
};

export async function login(req: LoginRequest): Promise<AuthResponse> {
  const res = await apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: req });
  return storeSession(res);
}

export async function logout(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout', {
      method: 'POST',
      body: { refresh_token: getRefreshToken() },
    });
  } finally {
    clearAuthToken();
  }
}

export async function me(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/auth/me');
}

export async function registerCompany(req: RegisterCompanyRequest): Promise<AuthResponse> {
  const res = await apiFetch<AuthResponse>('/auth/signup', { method: 'POST', body: req });
  return storeSession(res);
}

export async function updateProfile(req: UpdateProfileRequest): Promise<AuthUser> {
  return apiFetch<AuthUser>('/auth/me', { method: 'PATCH', body: req });
}

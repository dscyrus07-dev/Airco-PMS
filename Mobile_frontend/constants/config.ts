import Constants from 'expo-constants';

/**
 * API base URL resolution order:
 *   1. EXPO_PUBLIC_API_URL (inlined at bundle time — dev overrides, see .env.example)
 *   2. app.json expo.extra.apiUrl (production default)
 * The value always carries the /api/v1 prefix.
 */
const fromEnv = process.env.EXPO_PUBLIC_API_URL;
const fromConfig = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;

export const API_BASE_URL = (fromEnv ?? fromConfig ?? '').replace(/\/+$/, '');

/** Origin without the /api/vN suffix — media paths (/uploads/…) hang off it. */
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+$/, '');

/** Company operational timezone — matches backend schedule interpretation. */
export const TIME_ZONE = 'Asia/Kolkata';

export const REQUEST_TIMEOUT_MS = 20_000;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

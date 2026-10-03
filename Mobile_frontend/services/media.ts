/**
 * Media upload — POST /media/uploads (multipart).
 * Uses XMLHttpRequest instead of fetch for real upload progress on RN.
 * Server validates MIME + magic bytes (JPEG/PNG/WebP) and a 10 MB cap;
 * the client-side checks here only exist to fail fast, never to replace
 * server validation.
 */

import { API_BASE_URL, ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '@/constants/config';
import { getAccessToken } from '@/services/auth';
import { ApiError } from '@/services/api';

export interface LocalPhoto {
  /** Local file:// or content:// URI from the picker. */
  uri: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
}

export interface UploadedMedia {
  url: string;
  key: string;
}

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const guessMime = (fileName: string, mimeType?: string | null): string => {
  if (mimeType && (ALLOWED_IMAGE_TYPES as readonly string[]).includes(mimeType)) return mimeType;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MIME[ext] ?? 'image/jpeg';
};

const parseUploadError = (status: number, body: string): ApiError => {
  try {
    const detail = (JSON.parse(body) as { detail?: { message?: string } | string })?.detail;
    if (typeof detail === 'string' && detail) return new ApiError(status, detail);
    if (detail && typeof detail === 'object' && detail.message)
      return new ApiError(status, detail.message);
  } catch {
    /* fall through to generic */
  }
  return new ApiError(status, status === 413 ? 'Photo is too large.' : `Upload failed (${status}).`);
};

export const uploadImage = (
  photo: LocalPhoto,
  onProgress?: (fraction: number) => void
): Promise<UploadedMedia> =>
  new Promise((resolve, reject) => {
    const mime = guessMime(photo.fileName, photo.mimeType);
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(mime)) {
      reject(new ApiError(422, 'Only JPEG, PNG or WebP photos are allowed.'));
      return;
    }
    if (photo.fileSize && photo.fileSize > MAX_UPLOAD_BYTES) {
      reject(new ApiError(422, 'Photo exceeds the 10 MB limit.'));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}/media/uploads`);
    xhr.setRequestHeader('Accept', 'application/json');

    void getAccessToken().then((token) => {
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      if (xhr.upload) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
        };
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as UploadedMedia);
          } catch {
            reject(new ApiError(0, 'Upload succeeded but the response was unreadable.'));
          }
        } else {
          reject(parseUploadError(xhr.status, xhr.responseText));
        }
      };
      xhr.onerror = () =>
        reject(new ApiError(0, 'Cannot reach the server. Check your connection and try again.'));
      xhr.ontimeout = () =>
        reject(new ApiError(0, 'The upload timed out. Check your connection and try again.'));
      xhr.timeout = 60_000;

      const form = new FormData();
      // React Native FormData accepts {uri,name,type} file descriptors.
      form.append('file', {
        uri: photo.uri,
        name: photo.fileName || `photo-${Date.now()}.jpg`,
        type: mime,
      } as unknown as Blob);
      xhr.send(form);
    });
  });

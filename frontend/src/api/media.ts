import { apiFetch } from './client';
import { UploadResponse } from './types';

/**
 * Upload a task-evidence photo. Returns a URL the frontend then attaches to
 * POST /tasks/:uid/complete. Uses multipart/form-data — no JSON body.
 */
export async function uploadPhoto(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch<UploadResponse>('/media/uploads', { method: 'POST', formData });
}

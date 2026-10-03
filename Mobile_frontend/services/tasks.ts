/**
 * Task service — employee-facing calls only.
 * The server already scopes GET /tasks to the caller's own assignments for
 * the employee role, and enforces assignee checks on every mutation.
 *
 * Note: POST /tasks/{id}/complete and /request-redo exist but are staff-only
 * (employees get 403) — the employee flow is start → submit → supervisor
 * review on the web side.
 */

import { apiFetch } from '@/services/api';
import type { ListResponse, Task, Zone } from '@/types/api';

export const listMyTasks = (limit = 200): Promise<ListResponse<Task>> =>
  apiFetch<ListResponse<Task>>('/tasks', { query: { limit } });

export const listZones = (): Promise<ListResponse<Zone>> =>
  apiFetch<ListResponse<Zone>>('/zones');

export const getTask = (taskUid: string): Promise<Task> =>
  apiFetch<Task>(`/tasks/${encodeURIComponent(taskUid)}`);

export const startTask = (taskUid: string): Promise<Task> =>
  apiFetch<Task>(`/tasks/${encodeURIComponent(taskUid)}/start`, { method: 'POST' });

/** Employee completion path — status → submitted, awaits supervisor review. */
export const submitTask = (
  taskUid: string,
  payload: { note?: string; photo_urls: string[] }
): Promise<Task> =>
  apiFetch<Task>(`/tasks/${encodeURIComponent(taskUid)}/submit`, {
    method: 'POST',
    body: payload,
  });

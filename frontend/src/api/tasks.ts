import { apiFetch } from './client';
import { Task } from '../types';
import {
  ListResponse,
  TaskActionRequest,
  TaskCompleteRequest,
  TaskCompleteResponse,
  TaskCreateRequest,
  TaskReassignRequest,
  TaskRejectRequest,
  TaskSubmitRequest,
  TaskUpdateRequest,
} from './types';

export interface TaskListParams {
  property_uid?: string;
  employee_uid?: string;
  zone_uid?: string;
  status?: string;
  task_type?: string;
  search?: string;
}

export async function listTasks(params: TaskListParams = {}): Promise<ListResponse<Task>> {
  return apiFetch<ListResponse<Task>>('/tasks', { query: params });
}

export async function createTask(req: TaskCreateRequest): Promise<Task> {
  return apiFetch<Task>('/tasks', { method: 'POST', body: req });
}

export async function updateTask(task_uid: string, req: TaskUpdateRequest): Promise<Task> {
  return apiFetch<Task>(`/tasks/${task_uid}`, { method: 'PATCH', body: req });
}

export async function deleteTask(task_uid: string): Promise<void> {
  return apiFetch<void>(`/tasks/${task_uid}`, { method: 'DELETE' });
}

/** Employee starts their assigned task — status → in_progress + history event. */
export async function startTask(task_uid: string): Promise<Task> {
  return apiFetch<Task>(`/tasks/${task_uid}/start`, { method: 'POST' });
}

/**
 * Mark complete with mandatory photo evidence (URLs from POST /media/uploads).
 * Backend appends the completion event to the task history and, for repetitive
 * tasks, returns the regenerated next instance as `generated_task`.
 */
export async function completeTask(
  task_uid: string,
  req: TaskCompleteRequest
): Promise<TaskCompleteResponse> {
  return apiFetch<TaskCompleteResponse>(`/tasks/${task_uid}/complete`, {
    method: 'POST',
    body: req,
  });
}

export async function requestTaskRedo(task_uid: string, note?: string): Promise<Task> {
  return apiFetch<Task>(`/tasks/${task_uid}/request-redo`, {
    method: 'POST',
    body: { note } satisfies TaskActionRequest,
  });
}

export async function reassignTask(task_uid: string, employee_uid: string | null): Promise<Task> {
  return apiFetch<Task>(`/tasks/${task_uid}/assignee`, {
    method: 'PATCH',
    body: { employee_uid } satisfies TaskReassignRequest,
  });
}

/** Employee submits finished work for supervisor review → 'submitted'. */
export async function submitTask(
  task_uid: string,
  req: TaskSubmitRequest
): Promise<Task> {
  return apiFetch<Task>(`/tasks/${task_uid}/submit`, { method: 'POST', body: req });
}

/** Supervisor/staff approves a submitted task → 'completed'. */
export async function approveTask(
  task_uid: string,
  note?: string
): Promise<TaskCompleteResponse> {
  return apiFetch<TaskCompleteResponse>(`/tasks/${task_uid}/approve`, {
    method: 'POST',
    body: { note } satisfies TaskActionRequest,
  });
}

/** Supervisor/staff rejects a submission with a reason → 'reopened'. */
export async function rejectTask(task_uid: string, reason: string): Promise<Task> {
  return apiFetch<Task>(`/tasks/${task_uid}/reject`, {
    method: 'POST',
    body: { reason } satisfies TaskRejectRequest,
  });
}

/** Reopen a completed/cancelled/rejected task. */
export async function reopenTask(task_uid: string, note?: string): Promise<Task> {
  return apiFetch<Task>(`/tasks/${task_uid}/reopen`, {
    method: 'POST',
    body: { note } satisfies TaskActionRequest,
  });
}

export async function tasksToday(property_uid?: string): Promise<import('./types').TodayTasksResponse> {
  return apiFetch<import('./types').TodayTasksResponse>('/tasks/today', {
    query: { property_uid },
  });
}

export async function tasksHistory(
  params: import('./types').TaskHistoryParams = {}
): Promise<import('./types').TaskHistoryResponse> {
  return apiFetch<import('./types').TaskHistoryResponse>('/tasks/history', { query: params });
}

export async function generateOccurrence(
  template_uid: string,
  occurrence_key: string
): Promise<Task> {
  return apiFetch<Task>(`/templates/${template_uid}/generate-occurrence`, {
    method: 'POST',
    body: { occurrence_key },
  });
}

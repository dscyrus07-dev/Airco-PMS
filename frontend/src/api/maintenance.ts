import { apiFetch } from './client';
import { MaintenanceTicket } from '../types';
import {
  ListResponse,
  MaintenanceAssignRequest,
  MaintenanceCreateRequest,
  MaintenanceResolveRequest,
  MaintenanceUpdateRequest,
} from './types';

export interface MaintenanceListParams {
  property_uid?: string;
  room_uid?: string;
  assigned_to?: string;
  status?: string;
  priority?: string;
  search?: string;
}

export async function listMaintenance(
  params: MaintenanceListParams = {}
): Promise<ListResponse<MaintenanceTicket>> {
  return apiFetch<ListResponse<MaintenanceTicket>>('/maintenance', { query: params });
}

export async function getMaintenanceTicket(
  ticket_uid: string
): Promise<MaintenanceTicket> {
  return apiFetch<MaintenanceTicket>(`/maintenance/${ticket_uid}`);
}

/** Creates the ticket AND flips the room to 'maintenance' atomically. */
export async function createMaintenanceTicket(
  req: MaintenanceCreateRequest
): Promise<MaintenanceTicket> {
  return apiFetch<MaintenanceTicket>('/maintenance', { method: 'POST', body: req });
}

/**
 * Grouped ticket creation — tickets are zone-grouped server-side and each
 * zone group is allocated to ONE employee via the persistent round-robin.
 */
export async function createWorkBatch(
  req: import('./types').WorkBatchCreateRequest
): Promise<import('./types').WorkBatchCreateResponse> {
  return apiFetch<import('./types').WorkBatchCreateResponse>('/work-batches', {
    method: 'POST',
    body: req,
  });
}

export async function updateMaintenanceTicket(
  ticket_uid: string,
  req: MaintenanceUpdateRequest
): Promise<MaintenanceTicket> {
  return apiFetch<MaintenanceTicket>(`/maintenance/${ticket_uid}`, {
    method: 'PATCH',
    body: req,
  });
}

export async function assignMaintenanceTicket(
  ticket_uid: string,
  employee_uid: string | null
): Promise<MaintenanceTicket> {
  return apiFetch<MaintenanceTicket>(`/maintenance/${ticket_uid}/assign`, {
    method: 'POST',
    body: { employee_uid } satisfies MaintenanceAssignRequest,
  });
}

export async function startMaintenanceTicket(
  ticket_uid: string
): Promise<MaintenanceTicket> {
  return apiFetch<MaintenanceTicket>(`/maintenance/${ticket_uid}/start`, {
    method: 'POST',
  });
}

export async function holdMaintenanceTicket(
  ticket_uid: string,
  note?: string
): Promise<MaintenanceTicket> {
  return apiFetch<MaintenanceTicket>(`/maintenance/${ticket_uid}/hold`, {
    method: 'POST',
    body: { note },
  });
}

export async function resolveMaintenanceTicket(
  ticket_uid: string,
  req: MaintenanceResolveRequest
): Promise<MaintenanceTicket> {
  return apiFetch<MaintenanceTicket>(`/maintenance/${ticket_uid}/resolve`, {
    method: 'POST',
    body: req,
  });
}

/** PM disapproves a submitted resolution — returns the ticket for rework. */
export async function disapproveMaintenanceTicket(
  ticket_uid: string,
  reason: string
): Promise<MaintenanceTicket> {
  return apiFetch<MaintenanceTicket>(`/maintenance/${ticket_uid}/disapprove`, {
    method: 'POST',
    body: { reason },
  });
}

export async function closeMaintenanceTicket(
  ticket_uid: string
): Promise<MaintenanceTicket> {
  return apiFetch<MaintenanceTicket>(`/maintenance/${ticket_uid}/close`, {
    method: 'POST',
  });
}

/** Per-room maintenance history. */
export async function roomMaintenanceHistory(
  room_uid: string
): Promise<ListResponse<MaintenanceTicket>> {
  return apiFetch<ListResponse<MaintenanceTicket>>(`/rooms/${room_uid}/maintenance`);
}

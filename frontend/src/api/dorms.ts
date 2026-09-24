import { apiFetch } from './client';
import { Dorm } from '../types';
import {
  BedStatusUpdateRequest,
  DormCreateRequest,
  DormUpdateRequest,
  ListResponse,
} from './types';

export interface DormListParams {
  property_uid?: string;
  zone_uid?: string;
}

export async function listDorms(params: DormListParams = {}): Promise<ListResponse<Dorm>> {
  return apiFetch<ListResponse<Dorm>>('/dorms', { query: params });
}

export async function createDorm(req: DormCreateRequest): Promise<Dorm> {
  return apiFetch<Dorm>('/dorms', { method: 'POST', body: req });
}

export async function updateDorm(dorm_uid: string, req: DormUpdateRequest): Promise<Dorm> {
  return apiFetch<Dorm>(`/dorms/${dorm_uid}`, { method: 'PATCH', body: req });
}

export async function deleteDorm(dorm_uid: string): Promise<void> {
  return apiFetch<void>(`/dorms/${dorm_uid}`, { method: 'DELETE' });
}

/** Guest checkout — all occupied beds transition to cleaning (backend-owned cascade). */
export async function checkoutDorm(dorm_uid: string): Promise<Dorm> {
  return apiFetch<Dorm>(`/dorms/${dorm_uid}/checkout`, { method: 'POST' });
}

/** Request housekeeping — occupied/available beds queue for cleaning. */
export async function markDormCleaning(dorm_uid: string): Promise<Dorm> {
  return apiFetch<Dorm>(`/dorms/${dorm_uid}/mark-cleaning`, { method: 'POST' });
}

/**
 * Update a single bed's status. Returns the containing dorm so nested bed
 * state stays consistent. May trigger backend automation rules.
 */
export async function updateBedStatus(
  bed_uid: string,
  req: BedStatusUpdateRequest
): Promise<Dorm> {
  return apiFetch<Dorm>(`/beds/${bed_uid}/status`, { method: 'PATCH', body: req });
}

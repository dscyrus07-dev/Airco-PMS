import { apiFetch } from './client';
import { Dorm, Task } from '../types';
import { CheckoutResponse } from './rooms';
import {
  CheckInRequest,
  DormBulkCreateRequest,
  DormBulkCreateResponse,
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

/** Line-item bulk creation — all-or-nothing; any invalid row 422s the batch. */
export async function bulkCreateDorms(
  req: DormBulkCreateRequest
): Promise<DormBulkCreateResponse> {
  return apiFetch<DormBulkCreateResponse>('/dorms/bulk', { method: 'POST', body: req });
}

export async function updateDorm(dorm_uid: string, req: DormUpdateRequest): Promise<Dorm> {
  return apiFetch<Dorm>(`/dorms/${dorm_uid}`, { method: 'PATCH', body: req });
}

export async function deleteDorm(dorm_uid: string): Promise<void> {
  return apiFetch<void>(`/dorms/${dorm_uid}`, { method: 'DELETE' });
}

/** Guest checkout — all occupied beds transition to cleaning (backend-owned
 *  cascade). Returns the dorm plus the checkout-cleaning tasks created in
 *  the same transaction. */
export async function checkoutDorm(
  dorm_uid: string
): Promise<CheckoutResponse<Dorm>> {
  return apiFetch<CheckoutResponse<Dorm>>(`/dorms/${dorm_uid}/checkout`, {
    method: 'POST',
  });
}

/** Acknowledge housekeeping work — cleaning beds become available. */
export async function markDormCleaned(dorm_uid: string): Promise<Dorm> {
  return apiFetch<Dorm>(`/dorms/${dorm_uid}/mark-cleaned`, { method: 'POST' });
}

/**
 * Bed occupancy commands — check-in requires a guest name; check-out closes
 * the open occupancy and flags the bed CLEANING in the same transaction.
 * Both return the containing dorm so nested bed state stays consistent.
 */
export async function checkInBed(bed_uid: string, req: CheckInRequest): Promise<Dorm> {
  return apiFetch<Dorm>(`/beds/${bed_uid}/check-in`, { method: 'POST', body: req });
}

export async function checkOutBed(
  bed_uid: string
): Promise<CheckoutResponse<Dorm>> {
  return apiFetch<CheckoutResponse<Dorm>>(`/beds/${bed_uid}/check-out`, {
    method: 'POST',
  });
}

import { apiFetch } from './client';
import { Room, Task } from '../types';
import {
  BulkUnitStatusRequest,
  BulkUnitStatusResponse,
  CheckInRequest,
  ListResponse,
  ResourceTransitionRequest,
  ResourceTransitionResponse,
  RoomBulkCreateRequest,
  RoomBulkCreateResponse,
  RoomBulkDeleteRequest,
  RoomCreateRequest,
  RoomUpdateRequest,
} from './types';

export interface RoomListParams {
  property_uid?: string;
  zone_uid?: string;
  status?: Room['status'];
  search?: string;
}

export async function listRooms(params: RoomListParams = {}): Promise<ListResponse<Room>> {
  return apiFetch<ListResponse<Room>>('/rooms', { query: params });
}

export async function createRoom(req: RoomCreateRequest): Promise<Room> {
  return apiFetch<Room>('/rooms', { method: 'POST', body: req });
}

export async function bulkCreateRooms(
  req: RoomBulkCreateRequest
): Promise<RoomBulkCreateResponse> {
  return apiFetch<RoomBulkCreateResponse>('/rooms/bulk', { method: 'POST', body: req });
}

export async function updateRoom(room_uid: string, req: RoomUpdateRequest): Promise<Room> {
  return apiFetch<Room>(`/rooms/${room_uid}`, { method: 'PATCH', body: req });
}

export async function deleteRoom(room_uid: string): Promise<void> {
  return apiFetch<void>(`/rooms/${room_uid}`, { method: 'DELETE' });
}

/** Bulk delete — backend refuses if any selected room is occupied. */
export async function bulkDeleteRooms(
  req: RoomBulkDeleteRequest
): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>('/rooms/bulk-delete', {
    method: 'POST',
    body: req,
  });
}

/** Multi-select bulk actions — checkout / queue-cleaning / mark-cleaned / release. */
export async function bulkUpdateUnits(
  req: BulkUnitStatusRequest
): Promise<BulkUnitStatusResponse> {
  return apiFetch<BulkUnitStatusResponse>('/units/bulk-status', { method: 'POST', body: req });
}

// ---------------------------------------------------------------------------
// Occupancy commands — `occupied` is backed by an occupancies row, not a flag
// ---------------------------------------------------------------------------

export async function checkInRoom(room_uid: string, req: CheckInRequest): Promise<Room> {
  return apiFetch<Room>(`/rooms/${room_uid}/check-in`, { method: 'POST', body: req });
}

/** Room payload + the checkout-cleaning tasks generated in the same
 *  transaction (empty for the checkout-release path). */
export type CheckoutResponse<T> = T & { generated_tasks?: Task[] };

export async function checkOutRoom(
  room_uid: string
): Promise<CheckoutResponse<Room>> {
  return apiFetch<CheckoutResponse<Room>>(`/rooms/${room_uid}/check-out`, {
    method: 'POST',
  });
}

/** Super Admin administrative transition — audited ADMIN_OVERRIDE event. */
export async function transitionResource(
  resource_type: 'room' | 'dorm' | 'bed' | 'washroom' | 'fixture',
  resource_id: string,
  req: ResourceTransitionRequest
): Promise<ResourceTransitionResponse> {
  return apiFetch<ResourceTransitionResponse>(
    `/resources/${resource_type}/${resource_id}/transition`,
    { method: 'POST', body: req }
  );
}

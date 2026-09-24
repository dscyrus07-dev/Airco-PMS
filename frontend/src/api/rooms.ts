import { apiFetch } from './client';
import { Room } from '../types';
import {
  BulkUnitStatusRequest,
  BulkUnitStatusResponse,
  ListResponse,
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

/** Multi-select bulk actions — checkout / cleaning / mark-available on rooms & beds. */
export async function bulkUpdateUnits(
  req: BulkUnitStatusRequest
): Promise<BulkUnitStatusResponse> {
  return apiFetch<BulkUnitStatusResponse>('/units/bulk-status', { method: 'POST', body: req });
}

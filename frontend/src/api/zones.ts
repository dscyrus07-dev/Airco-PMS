import { apiFetch } from './client';
import { Zone } from '../types';
import { ListResponse, ZoneCreateRequest, ZoneUpdateRequest } from './types';

export async function listZones(property_uid?: string): Promise<ListResponse<Zone>> {
  return apiFetch<ListResponse<Zone>>('/zones', { query: { property_uid } });
}

export async function createZone(req: ZoneCreateRequest): Promise<Zone> {
  return apiFetch<Zone>('/zones', { method: 'POST', body: req });
}

export async function updateZone(zone_uid: string, req: ZoneUpdateRequest): Promise<Zone> {
  return apiFetch<Zone>(`/zones/${zone_uid}`, { method: 'PATCH', body: req });
}

export async function deleteZone(zone_uid: string): Promise<void> {
  return apiFetch<void>(`/zones/${zone_uid}`, { method: 'DELETE' });
}

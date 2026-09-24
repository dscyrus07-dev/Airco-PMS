import { apiFetch } from './client';
import { Area } from '../types';
import { AreaCreateRequest, AreaUpdateRequest, ListResponse } from './types';

export async function listAreas(property_uid?: string): Promise<ListResponse<Area>> {
  return apiFetch<ListResponse<Area>>('/areas', { query: { property_uid } });
}

export async function createArea(req: AreaCreateRequest): Promise<Area> {
  return apiFetch<Area>('/areas', { method: 'POST', body: req });
}

export async function updateArea(area_uid: string, req: AreaUpdateRequest): Promise<Area> {
  return apiFetch<Area>(`/areas/${area_uid}`, { method: 'PATCH', body: req });
}

export async function deleteArea(area_uid: string): Promise<void> {
  return apiFetch<void>(`/areas/${area_uid}`, { method: 'DELETE' });
}

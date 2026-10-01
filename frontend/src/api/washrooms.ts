import { apiFetch } from './client';
import { Washroom } from '../types';
import {
  ListResponse,
  UnitAllocationRequest,
  WashroomBulkCreateRequest,
  WashroomBulkCreateResponse,
  WashroomCreateRequest,
  WashroomFixtureUpdateRequest,
  WashroomUpdateRequest,
} from './types';

export interface WashroomListParams {
  property_uid?: string;
  zone_uid?: string;
  status?: Washroom['status'];
  search?: string;
}

export async function listWashrooms(
  params: WashroomListParams = {}
): Promise<ListResponse<Washroom>> {
  return apiFetch<ListResponse<Washroom>>('/washrooms', { query: params });
}

export async function getWashroom(washroom_uid: string): Promise<Washroom> {
  return apiFetch<Washroom>(`/washrooms/${washroom_uid}`);
}

export async function createWashroom(
  req: WashroomCreateRequest
): Promise<Washroom> {
  return apiFetch<Washroom>('/washrooms', { method: 'POST', body: req });
}

export async function bulkCreateWashrooms(
  req: WashroomBulkCreateRequest
): Promise<WashroomBulkCreateResponse> {
  return apiFetch<WashroomBulkCreateResponse>('/washrooms/bulk', {
    method: 'POST',
    body: req,
  });
}

export async function updateWashroom(
  washroom_uid: string,
  req: WashroomUpdateRequest
): Promise<Washroom> {
  return apiFetch<Washroom>(`/washrooms/${washroom_uid}`, {
    method: 'PATCH',
    body: req,
  });
}

export async function updateWashroomFixture(
  washroom_uid: string,
  fixture_uid: string,
  req: WashroomFixtureUpdateRequest
): Promise<Washroom> {
  return apiFetch<Washroom>(
    `/washrooms/${washroom_uid}/fixtures/${fixture_uid}`,
    { method: 'PATCH', body: req }
  );
}

export async function allocateWashroom(
  washroom_uid: string,
  req: UnitAllocationRequest
): Promise<Washroom> {
  return apiFetch<Washroom>(`/washrooms/${washroom_uid}/allocation`, {
    method: 'PATCH',
    body: req,
  });
}

export async function deleteWashroom(washroom_uid: string): Promise<void> {
  return apiFetch<void>(`/washrooms/${washroom_uid}`, { method: 'DELETE' });
}

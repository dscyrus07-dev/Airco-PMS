/**
 * Maintenance service — employee-facing calls only.
 * Server enforces zone/area coverage on create and assignee checks on
 * start/resolve; hold/close/disapprove are staff-only and intentionally absent.
 */

import { apiFetch } from '@/services/api';
import type {
  EligibleLocations,
  ListResponse,
  MaintenanceCreatePayload,
  MaintenanceTicket,
} from '@/types/api';

export const listMyTickets = (): Promise<ListResponse<MaintenanceTicket>> =>
  apiFetch<ListResponse<MaintenanceTicket>>('/maintenance');

export const getTicket = (ticketUid: string): Promise<MaintenanceTicket> =>
  apiFetch<MaintenanceTicket>(`/maintenance/${encodeURIComponent(ticketUid)}`);

/** Rooms + dorms inside the caller's zone/area coverage — the only
 *  locations an employee may raise a ticket against. */
export const getEligibleLocations = (): Promise<EligibleLocations> =>
  apiFetch<EligibleLocations>('/maintenance/eligible-locations');

export const createTicket = (payload: MaintenanceCreatePayload): Promise<MaintenanceTicket> =>
  apiFetch<MaintenanceTicket>('/maintenance', { method: 'POST', body: payload });

export const startTicket = (ticketUid: string): Promise<MaintenanceTicket> =>
  apiFetch<MaintenanceTicket>(`/maintenance/${encodeURIComponent(ticketUid)}/start`, {
    method: 'POST',
  });

export const resolveTicket = (
  ticketUid: string,
  payload: { resolution_notes: string; photo_urls: string[] }
): Promise<MaintenanceTicket> =>
  apiFetch<MaintenanceTicket>(`/maintenance/${encodeURIComponent(ticketUid)}/resolve`, {
    method: 'POST',
    body: payload,
  });

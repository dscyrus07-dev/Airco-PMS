import { apiFetch } from './client';
import { Employee } from '../types';
import {
  EmployeeCreateRequest,
  EmployeeUpdateRequest,
  EmployeeZoneAssignRequest,
  ListResponse,
} from './types';

export interface EmployeeListParams {
  property_uid?: string;
  zone_uid?: string;
  department?: string;
  status?: string;
  search?: string;
}

export async function listEmployees(
  params: EmployeeListParams = {}
): Promise<ListResponse<Employee>> {
  return apiFetch<ListResponse<Employee>>('/employees', { query: params });
}

export async function createEmployee(req: EmployeeCreateRequest): Promise<Employee> {
  return apiFetch<Employee>('/employees', { method: 'POST', body: req });
}

export async function updateEmployee(
  employee_uid: string,
  req: EmployeeUpdateRequest
): Promise<Employee> {
  return apiFetch<Employee>(`/employees/${employee_uid}`, { method: 'PATCH', body: req });
}

/** Zone assignment — used by drag-and-drop board and the dropdown fallback. */
export async function assignEmployeeToZone(
  employee_uid: string,
  zone_uid: string | null
): Promise<Employee> {
  return apiFetch<Employee>(`/employees/${employee_uid}/zone`, {
    method: 'PATCH',
    body: { zone_uid } satisfies EmployeeZoneAssignRequest,
  });
}

/** Area assignment — employee covers every zone inside the area. */
export async function assignEmployeeToArea(
  employee_uid: string,
  area_uid: string | null
): Promise<Employee> {
  return apiFetch<Employee>(`/employees/${employee_uid}/zone`, {
    method: 'PATCH',
    body: { zone_uid: null, area_uid } satisfies EmployeeZoneAssignRequest,
  });
}

export async function deactivateEmployee(employee_uid: string): Promise<Employee> {
  return apiFetch<Employee>(`/employees/${employee_uid}/deactivate`, { method: 'POST' });
}

export async function deleteEmployee(employee_uid: string): Promise<void> {
  return apiFetch<void>(`/employees/${employee_uid}`, { method: 'DELETE' });
}

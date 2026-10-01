import { apiFetch } from './client';
import { Employee } from '../types';
import { EmployeeCreateRequest, EmployeeUpdateRequest, ListResponse } from './types';

export interface HrDashboard {
  total_employees: number;
  active_employees: number;
  inactive_employees: number;
  on_leave: number;
  departments: number;
  new_last_30d: number;
  by_department: { department: string; count: number }[];
  recent_hires: { employee_uid: string; name: string; department: string | null; created_at: string | null }[];
}

export interface AuditLogItem {
  event_uid: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_name: string | null;
  actor_name: string | null;
  detail: Record<string, unknown> | null;
  created_at: string | null;
}

export interface HrTaskItem {
  task_uid: string;
  ticket_number: string;
  title: string;
  task_type: string;
  status: string;
  priority: string;
  assigned_to_name: string | null;
  allocation_method: string | null;
  allocation_status: string | null;
  room_number: string | null;
  dorm_name: string | null;
  due_date: string | null;
  created_at: string | null;
  completed_at: string | null;
}

export interface HrTasksDashboard {
  total: number;
  open: number;
  completed: number;
  cancelled: number;
  overdue: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  by_employee: { employee: string; count: number }[];
}

export interface TaskTimeline {
  task: HrTaskItem & { ticket_number: string };
  events: { type: string; at: string | null; actor_name: string | null; note: string | null }[];
}

export interface HrAccount {
  user_uid: string;
  name: string;
  email: string;
  phone: string | null;
  property_uid: string | null;
  property_name: string | null;
  is_active: boolean;
  created_at: string | null;
}

// ---- HR-scoped endpoints ----

export async function hrDashboard(): Promise<HrDashboard> {
  return apiFetch<HrDashboard>('/hr/dashboard');
}

export async function hrListEmployees(params: {
  zone_uid?: string; department?: string; status?: string;
  search?: string; page?: number; limit?: number;
} = {}): Promise<ListResponse<Employee>> {
  return apiFetch<ListResponse<Employee>>('/hr/employees', { query: params });
}

export async function hrCreateEmployee(req: EmployeeCreateRequest): Promise<Employee> {
  return apiFetch<Employee>('/hr/employees', { method: 'POST', body: req });
}

export async function hrUpdateEmployee(
  employeeUid: string, req: EmployeeUpdateRequest
): Promise<Employee> {
  return apiFetch<Employee>(`/hr/employees/${employeeUid}`, {
    method: 'PATCH', body: req,
  });
}

export async function hrDeactivateEmployee(employeeUid: string): Promise<Employee> {
  return apiFetch<Employee>(`/hr/employees/${employeeUid}/deactivate`, { method: 'POST' });
}

export async function hrActivateEmployee(employeeUid: string): Promise<Employee> {
  return apiFetch<Employee>(`/hr/employees/${employeeUid}/activate`, { method: 'POST' });
}

export async function hrEmployeeLogs(params: {
  employee_uid?: string; action?: string; actor?: string;
  date_from?: string; date_to?: string; page?: number; limit?: number;
} = {}): Promise<ListResponse<AuditLogItem>> {
  return apiFetch<ListResponse<AuditLogItem>>('/hr/employee-logs', { query: params });
}

export async function hrTasksDashboard(): Promise<HrTasksDashboard> {
  return apiFetch<HrTasksDashboard>('/hr/tasks/dashboard');
}

export async function hrListTasks(params: {
  status?: string; task_type?: string; search?: string;
  page?: number; limit?: number;
} = {}): Promise<ListResponse<HrTaskItem>> {
  return apiFetch<ListResponse<HrTaskItem>>('/hr/tasks', { query: params });
}

export async function hrTaskTimeline(taskUid: string): Promise<TaskTimeline> {
  return apiFetch<TaskTimeline>(`/hr/tasks/${taskUid}/timeline`);
}

// ---- Super-admin HR account management ----

export async function listHrAccounts(): Promise<{ items: HrAccount[] }> {
  return apiFetch<{ items: HrAccount[] }>('/admin/hr');
}

export async function createHrAccount(req: {
  property_uid: string; name: string; email: string;
  phone?: string; password: string;
}): Promise<HrAccount> {
  return apiFetch<HrAccount>('/admin/hr', { method: 'POST', body: req });
}

export async function toggleHrAccount(userUid: string): Promise<HrAccount> {
  return apiFetch<HrAccount>(`/admin/hr/${userUid}/toggle`, { method: 'POST' });
}

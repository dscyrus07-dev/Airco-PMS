import { Employee } from '../types';

export function isEmployeeDeactivated(employee: Pick<Employee, 'status'>): boolean {
  return employee.status.toLowerCase() === 'deactivated';
}

export function isEmployeeAssignable(
  employee: Pick<Employee, 'status' | 'leave_status'>
): boolean {
  return employee.status.toLowerCase() === 'active' && !employee.leave_status;
}

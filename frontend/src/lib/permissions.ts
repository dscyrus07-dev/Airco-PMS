import { AuthUser, PermissionAction, PermissionResource } from '../types';

export interface PermissionContext {
  property_uid?: string;
  employee_uid?: string;
  zone_uid?: string;
}

/**
 * Centralized authorization engine.
 * Determines if a given AuthUser has permission to perform an action on a resource.
 */
export function can(
  action: PermissionAction,
  resource: PermissionResource,
  user: AuthUser | null,
  context?: PermissionContext
): boolean {
  if (!user) return false;

  // 1. Super Admin has universal access across the entire company
  if (user.role === 'super_admin') {
    return true;
  }

  // 2. Property Manager has full operational access only within their assigned property
  if (user.role === 'property_manager') {
    // Cannot manage all properties or global company settings
    if (action === 'manage_all_properties' || action === 'manage_org_settings') {
      return false;
    }
    if (resource === 'companies') {
      return false;
    }

    // Property check: must match assigned property if context is provided
    if (context?.property_uid && context.property_uid !== user.property_uid) {
      return false;
    }

    // Allowed to manage zones, rooms, dorms, beds, employees and tasks in their property
    return true;
  }

  // 3. Employee: strictly self-scoped and read-only context
  if (user.role === 'employee') {
    // Disallowed across structural management
    if (
      resource === 'companies' ||
      resource === 'properties' ||
      resource === 'settings'
    ) {
      return false;
    }

    // Prohibited from creating or deleting zones, rooms, dorms, employees
    if (action === 'delete' || action === 'create' || action === 'assign') {
      return false;
    }

    // Tasks: can update their own tasks (e.g. mark done) and read tasks
    if (resource === 'tasks') {
      if (action === 'read') return true;
      if (action === 'update' && (!context?.employee_uid || context.employee_uid === user.employee_uid)) {
        return true;
      }
      return false;
    }

    // Rooms / Dorms / Zones: read-only status in their assigned zone/property
    if (resource === 'zones' || resource === 'rooms' || resource === 'dorms' || resource === 'beds') {
      return action === 'read';
    }

    // Employees: can read own profile and colleagues in same zone
    if (resource === 'employees') {
      return action === 'read';
    }

    return false;
  }

  return false;
}

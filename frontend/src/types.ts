export type UserRole = 'super_admin' | 'property_manager' | 'employee';

export type RoomStatus = 'available' | 'occupied' | 'cleaning' | 'maintenance';
export type BedStatus = 'available' | 'occupied' | 'cleaning' | 'maintenance';
export type DormType = 'Mixed Dorm' | 'Female Dorm' | 'Male Dorm';
export type WashroomType =
  | 'Attached'
  | 'Shared'
  | 'No Washroom'
  | 'Attached Washroom'
  | 'Shared Washroom';
export type EmployeeStatus =
  | 'Active'
  | 'On Leave'
  | 'Off Duty'
  | 'Probation'
  | 'active'
  | 'inactive';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent' | 'critical';
// pending = open/unassigned · assigned · in_progress · submitted (awaiting
// review) · reopened (was rejected) · completed · cancelled · scheduled · overdue
export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'submitted'
  | 'reopened'
  | 'completed'
  | 'cancelled'
  | 'overdue'
  | 'scheduled';
export type TaskType = 'fixed' | 'repetitive' | 'automated';
export type RecurrenceSchedule =
  | 'hourly'
  | 'every_2_hours'
  | 'every_6_hours'
  | 'every_12_hours'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'custom';

/**
 * Events that can auto-generate a task. Evaluated by the backend automation
 * engine whenever the corresponding entity state changes server-side.
 */
export type AutomationTrigger =
  | 'bed_available_after_checkout' // bed transitions cleaning -> available
  | 'bed_marked_cleaning' // bed transitions occupied -> cleaning
  | 'room_checked_out'; // room transitions occupied -> cleaning

export interface AutomationRule {
  trigger: AutomationTrigger;
  scope_zone_uid?: string | null; // null = applies to the whole property
  template_title: string;
  template_description?: string;
  assign_to_uid?: string; // optional default assignee for generated tasks
}

export type TaskEventType =
  | 'allocated'
  | 'started'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'reopened'
  | 'completed'
  | 'redo_requested'
  | 'reassigned'
  | 'edited'
  | 'auto_generated';

export interface TaskHistoryEvent {
  event_uid: string;
  type: TaskEventType;
  at: string; // ISO timestamp
  actor_name: string;
  note?: string;
  photos?: string[]; // evidence photos attached to completion events
}

export interface Task {
  task_uid: string;
  ticket_number?: string; // TASK-YYYY-NNNNN — generated server-side
  property_uid?: string;
  zone_uid?: string | null;
  room_uid?: string | null;
  room_number?: string;
  supervisor_uid?: string | null;
  supervisor_name?: string;
  employee_uid?: string; // assignee
  assigned_to_uid?: string; // kept for backward compat with mock data
  assigned_to_name?: string; // denormalized display name
  title: string;
  description?: string;
  task_type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  due_date?: string;
  due_time?: string;
  start_time?: string; // HH:MM anchor for repetitive schedules
  recurrence_start_date?: string; // first day the schedule runs
  recurrence_end_date?: string;   // null/absent = runs forever
  recurrence_window_end?: string; // HH:MM — daily window end (hourly recurrences)
  created_by_name?: string;
  recurrence?: RecurrenceSchedule;
  recurrence_interval_days?: number; // used when recurrence === 'custom'
  automation_rule?: AutomationRule;
  history: TaskHistoryEvent[];
  submitted_at?: string;
  completed_at?: string;
  created_at?: string;
}

// ---------------------------------------------------------------------------
// Maintenance tickets
// ---------------------------------------------------------------------------

export type MaintenanceStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'on_hold'
  | 'resolved'
  | 'closed'
  | 'cancelled';

export type MaintenancePriority = 'low' | 'medium' | 'high' | 'critical';

export interface MaintenanceAttachment {
  attachment_uid: string;
  url: string;
  file_name?: string;
  mime_type?: string;
  size_bytes?: number;
  kind: 'issue' | 'resolution';
  uploaded_by_name?: string;
  created_at?: string;
}

export interface MaintenanceEvent {
  event_uid: string;
  action: string;
  actor_name?: string;
  comment?: string;
  at: string;
}

export interface MaintenanceTicket {
  ticket_uid: string;
  ticket_number: string; // MT-YYYY-NNNNN
  company_uid: string;
  property_uid: string;
  room_uid?: string | null;
  room_number?: string;
  dorm_uid?: string | null;
  dorm_name?: string;
  bed_uid?: string | null;
  bed_number?: string;
  location_label?: string; // server-computed: "Room 103" | "Dorm A · Bed 03" | "Dorm A"
  zone_uid?: string | null;
  allocation_batch_id?: string | null;
  allocation_status?: 'auto_assigned' | 'manually_assigned' | 'unassigned' | string;
  allocation_method?: 'round_robin' | 'manual' | 'reassign' | string;
  allocation_reason?: string;
  reported_by_name?: string;
  maintenance_type: string;
  issue: string;
  description?: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  assigned_to?: string | null; // employee_uid
  assigned_to_name?: string;
  due_date?: string;
  resolved_at?: string;
  closed_at?: string;
  resolution_notes?: string;
  events: MaintenanceEvent[];
  attachments: MaintenanceAttachment[];
  created_at?: string;
  updated_at?: string;
}

export interface Company {
  company_uid: string;
  name: string;
  legal_name?: string;
  brand_name: string;
  email: string;
  phone: string;
  address?: string;
  pin_code?: string;
  created_at: string;
}

export interface Property {
  property_uid: string;
  company_uid: string;
  name: string;
  code: string; // e.g. "PROP-001"
  location: string;
  city: string;
  state: string;
  manager_employee_uid?: string;
  manager_name: string;
  manager_email: string;
  manager_phone?: string;
  status: 'Active' | 'Maintenance' | 'Setup';
  created_at: string;
}

export interface Area {
  area_uid: string;
  property_uid: string;
  name: string; // e.g. "Ground Floor", "First Floor", "Second Floor", "Rooftop Terrace"
  code: string; // e.g. "AREA-001"
  level_number: number; // e.g. 0 for Ground, 1 for First Floor, -1 for Basement
  description?: string;
  created_at: string;
}

/**
 * What a zone is physically used for. Only 'stay' zones can contain
 * rooms/dorms/beds — common areas, dining, amenities etc. are bed-free.
 */
export type ZoneType =
  | 'stay'
  | 'common'
  | 'dining'
  | 'amenities'
  | 'outdoor'
  | 'back_of_house';

export interface Zone {
  zone_uid: string;
  property_uid: string;
  area_uid?: string | null; // direct reference to Area
  name: string;
  code: string; // e.g. "ZONE-001"
  zone_type?: ZoneType; // defaults to 'stay' when absent
  floor?: string; // display string / backward compatible area name
  description?: string;
  created_at: string;
}

export interface Bed {
  bed_uid: string;
  dorm_uid: string;
  bed_number: string; // e.g. "Bed 01"
  status: BedStatus;
  guest_name?: string;
}

export interface Room {
  room_uid: string;
  property_uid: string;
  zone_uid?: string | null; // null if unassigned
  room_number: string; // e.g. "101"
  type: string;
  area_sqft?: number;
  status: RoomStatus;
  bed_count: number;
  cleaning_note?: string;
  current_guest?: string;
  created_at: string;
}

export interface Dorm {
  dorm_uid: string;
  property_uid: string;
  zone_uid?: string | null; // null if unassigned
  name: string; // e.g. "Ganga Dorm A"
  dorm_type: DormType;
  washroom: WashroomType;
  floor?: string;
  area_sqft?: number;
  description?: string;
  status?: 'active' | 'maintenance' | string;
  beds: Bed[];
  created_at: string;
}

export interface Employee {
  employee_uid: string;
  company_uid: string;
  property_uid: string;
  zone_uid?: string | null; // null if "Not allocated to a zone"
  /** Area-level assignment — mutually exclusive with zone_uid; covers all zones in the area */
  area_uid?: string | null;
  name: string;
  email: string;
  phone: string;
  username: string;
  job_title: string;
  department:
    | 'Front Desk'
    | 'Housekeeping'
    | 'Maintenance'
    | 'Operations'
    | 'Food & Beverage'
    | 'Security'
    | string;
  status: EmployeeStatus;
  role: UserRole;
  salary?: string;
  shift?: string;
  joined_date: string;
  start_date?: string;
  avatar_color?: string;
  leave_balance_days?: number;
  leave_status?: boolean;
}

export interface AuthUser {
  uid: string;
  user_id?: string;
  name: string;
  email: string;
  username: string;
  role: UserRole;
  company_uid: string;
  property_uid?: string;
  employee_uid?: string;
  zone_uid?: string | null;
  phone?: string;
  job_title?: string;
  company_name?: string;
}

export type PermissionAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'assign'
  | 'manage_all_properties'
  | 'manage_org_settings';

export type PermissionResource =
  | 'companies'
  | 'properties'
  | 'areas'
  | 'zones'
  | 'rooms'
  | 'dorms'
  | 'beds'
  | 'employees'
  | 'tasks'
  | 'settings';

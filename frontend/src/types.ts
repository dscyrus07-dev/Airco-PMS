export type UserRole =
  | 'super_admin'
  | 'property_manager'
  | 'human_resource'
  | 'department_manager'
  | 'employee';

export type RoomStatus = 'available' | 'occupied' | 'cleaning' | 'maintenance';
export type BedStatus = 'available' | 'occupied' | 'cleaning' | 'maintenance' | 'inactive';
export type DormType = 'Mixed Dorm' | 'Female Dorm' | 'Male Dorm';
export type WashroomType =
  | 'Attached'
  | 'Shared'
  | 'No Washroom'
  | 'Attached Washroom'
  | 'Shared Washroom';
export type WashroomResourceType = 'male' | 'female' | 'unisex';
export type WashroomStatus = 'available' | 'cleaning' | 'maintenance' | 'inactive';
export type EmployeeStatus =
  | 'Active'
  | 'Deactivated'
  | 'On Leave'
  | 'Off Duty'
  | 'Probation'
  | 'active'
  | 'deactivated'
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
  | 'auto_generated'
  | 'evidence_deleted';

export interface TaskHistoryEvent {
  event_uid: string;
  type: TaskEventType;
  at: string; // ISO timestamp
  actor_name: string;
  note?: string;
  photos?: string[]; // evidence photos attached to completion events
}

export interface TaskCompletionImage {
  image_uid?: string | null;
  task_uid?: string;
  event_uid?: string | null;
  submission_uid?: string | null;
  url: string;
  file_name?: string | null;
  created_by_name?: string | null;
  created_at?: string;
}

export type CompletionSubmissionStatus = 'pending' | 'approved' | 'disapproved' | string;

export interface TaskCompletionSubmission {
  submission_uid: string;
  task_uid: string;
  event_uid?: string | null;
  attempt_number: number;
  employee_uid?: string | null;
  employee_name?: string | null;
  submitted_at?: string | null;
  status: CompletionSubmissionStatus;
  reviewed_at?: string | null;
  reviewer_uid?: string | null;
  reviewed_by_name?: string | null;
  review_comment?: string | null;
  images: TaskCompletionImage[];
}

export interface Task {
  task_uid: string;
  ticket_number?: string; // TASK-YYYY-NNNNN — generated server-side
  property_uid?: string;
  zone_uid?: string | null;
  area_uid?: string | null;
  room_uid?: string | null;
  room_number?: string;
  dorm_uid?: string | null;
  dorm_name?: string;
  bed_uids?: string[] | null; // beds covered by a dorm task
  washroom_uid?: string | null;
  washroom_name?: string;
  washroom_fixture_uid?: string | null;
  washroom_fixture_label?: string;
  supervisor_uid?: string | null;
  supervisor_name?: string;
  employee_uid?: string; // assignee
  assigned_to_uid?: string; // kept for backward compat with mock data
  assigned_to_name?: string; // denormalized display name
  title: string;
  description?: string;
  task_type: TaskType;
  /** provenance: 'manual' | 'checkout' | 'template' | 'automation' —
   *  checkout-generated cleaning is identified by data, not title text */
  origin?: 'manual' | 'checkout' | 'template' | 'automation';
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
  completion_images?: TaskCompletionImage[];
  completion_submissions?: TaskCompletionSubmission[];
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
  attempt?: number | null;
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
  washroom_uid?: string | null;
  washroom_name?: string;
  washroom_fixture_uid?: string | null;
  washroom_fixture_label?: string;
  location_label?: string; // server-computed target label
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

/**
 * Canonical two-axis state contract — resolved server-side by
 * ResourceStateService and serialized identically on every resource
 * payload. The frontend must never recompute these from task/ticket
 * arrays or guess them from `status`.
 *
 *   status            materialized projection (legacy single column)
 *   is_occupied       occupancy axis — open occupancy record
 *   occupancy_state   'occupied' | 'unoccupied' | null (no occupancy axis)
 *   operational_state 'available'|'cleaning'|'maintenance'|'inactive'
 *                     (fixture also 'operational')
 *   visual_state      the ONE visual classification: 'maintenance' → red,
 *                     'cleaning' → beige, 'inactive' → neutral,
 *                     'occupied' → violet, 'available' → green
 */
export type OccupancyState = 'occupied' | 'unoccupied';
export type OperationalState =
  | 'available'
  | 'occupied'
  | 'cleaning'
  | 'maintenance'
  | 'inactive'
  | 'operational';
export type VisualState =
  | 'available'
  | 'occupied'
  | 'cleaning'
  | 'maintenance'
  | 'inactive';

export interface ResourceStateContract {
  is_occupied?: boolean;
  occupancy_state?: OccupancyState | null;
  operational_state?: OperationalState | null;
  visual_state?: VisualState | null;
}

export interface Bed extends ResourceStateContract {
  bed_uid: string;
  dorm_uid: string;
  bed_number: string; // e.g. "Bed 01"
  status: BedStatus;
  /** occupancy axis — open occupancy record; survives a maintenance flag */
  guest_name?: string;
}

export interface Room extends ResourceStateContract {
  room_uid: string;
  property_uid: string;
  zone_uid?: string | null; // null if unassigned
  area_uid?: string | null;
  room_number: string; // e.g. "101"
  type: string;
  area_sqft?: number;
  status: RoomStatus;
  bed_count: number;
  cleaning_note?: string;
  current_guest?: string;
  created_at: string;
}

/** Real per-fixture record inside a washroom (washroom_fixtures table). */
export interface WashroomFixture extends ResourceStateContract {
  fixture_uid: string;
  washroom_uid: string;
  /** 'shower' | 'stall' | 'urinal' | 'sink' | 'mirror' | custom label */
  fixture_type: string;
  fixture_number: number;
  /** Display label, e.g. "Stall 02" */
  label: string;
  /** canonical: operational | maintenance | inactive (needs_cleaning is
   *  task-driven — see cleaning tasks, not a stored fixture state) */
  status: 'operational' | 'maintenance' | 'inactive';
  last_cleaned_at?: string | null;
  last_maintenance_at?: string | null;
}

export interface Washroom extends ResourceStateContract {
  washroom_uid: string;
  property_uid: string;
  zone_uid?: string | null;
  area_uid?: string | null;
  /** Set → attached washroom owned by ONE dorm (independent config).
   *  null → zone-level/common facility shared by the zone. */
  dorm_uid?: string | null;
  name: string;
  washroom_type: WashroomResourceType;
  /** Derived from real fixture rows — convenience counters, not columns */
  stall_count: number;
  urinal_count: number;
  shower_count: number;
  sink_count: number;
  mirror_count: number;
  bath_tub_count: number;
  jacuzzi_count: number;
  /** Extra named fixture types, e.g. { "Hand Dryer": 2 } — derived */
  custom_fixtures?: Record<string, number>;
  /** Real fixture records — the single source of truth */
  fixtures: WashroomFixture[];
  status: WashroomStatus;
  created_at: string;
}

export interface Dorm extends ResourceStateContract {
  dorm_uid: string;
  property_uid: string;
  zone_uid?: string | null; // null if unassigned
  area_uid?: string | null;
  name: string; // e.g. "Ganga Dorm A"
  dorm_type: DormType;
  washroom: WashroomType;
  floor?: string;
  area_sqft?: number;
  description?: string;
  /** operational status — same model as room (available|occupied|cleaning|maintenance) */
  status: 'available' | 'occupied' | 'cleaning' | 'maintenance';
  /** lifecycle flag — NOT operational status (spec §10: never conflated) */
  is_active?: boolean;
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
  deactivated_at?: string | null;
  reactivated_at?: string | null;
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

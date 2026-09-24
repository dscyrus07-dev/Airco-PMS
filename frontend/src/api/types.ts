import {
  Area,
  AuthUser,
  AutomationTrigger,
  BedStatus,
  Company,
  DormType,
  Employee,
  MaintenancePriority,
  Property,
  RecurrenceSchedule,
  RoomStatus,
  Task,
  TaskPriority,
  TaskStatus,
  TaskType,
  WashroomType,
  Zone,
  ZoneType,
} from '../types';

/**
 * Request/response DTOs for the backend contract documented in /API.md.
 * List endpoints return a paginated envelope.
 */

export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface LoginRequest {
  /** Email or username — backend resolves either */
  identifier: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: AuthUser;
  company: Company;
}

export interface RegisterCompanyRequest {
  company_name: string;
  brand_name: string;
  address: string;
  pin_code: string;
  email: string;
  phone: string;
  password: string;
  confirm_password?: string;
}

export interface MeResponse {
  user: AuthUser;
  company: Company;
}

export interface UpdateProfileRequest {
  name?: string;
  phone?: string;
  email?: string;
}

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

export interface UpdateCompanyRequest {
  name?: string;
  legal_name?: string;
  brand_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  pin_code?: string;
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

export interface PropertyCreateRequest {
  name: string;
  location: string;
  city: string;
  state: string;
  /** Manager account is created with the property — scoped to it */
  manager: {
    name: string;
    email: string;
    phone?: string;
    /** Optional — backend auto-generates a unique one from name/email */
    username?: string;
    password: string;
  };
}

export interface PropertyUpdateRequest {
  name?: string;
  location?: string;
  city?: string;
  state?: string;
  status?: Property['status'];
  manager_name?: string;
  manager_email?: string;
  manager_phone?: string;
}

// ---------------------------------------------------------------------------
// Areas (floors / structural levels within a property)
// ---------------------------------------------------------------------------

export interface AreaCreateRequest {
  property_uid: string;
  name: string;
  level_number?: number;
  description?: string;
}

export type AreaUpdateRequest = Partial<Omit<Area, 'area_uid' | 'property_uid' | 'created_at'>>;

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

export interface ZoneCreateRequest {
  property_uid: string;
  name: string;
  floor?: string;
  area_uid?: string | null;
  zone_type?: ZoneType;
  description?: string;
}

export type ZoneUpdateRequest = Partial<
  Omit<Zone, 'zone_uid' | 'property_uid' | 'created_at'>
>;

// ---------------------------------------------------------------------------
// Rooms / Dorms / Beds
// ---------------------------------------------------------------------------

export interface RoomCreateRequest {
  property_uid: string;
  room_number: string;
  type: string;
  area_sqft?: number;
  zone_uid?: string | null;
  bed_count?: number;
}

export interface RoomBulkCreateRequest {
  property_uid: string;
  start: number;
  end: number;
  type: string;
  area_sqft?: number;
  zone_uid?: string | null;
}

export interface RoomBulkCreateResponse {
  created: import('../types').Room[];
  /** Per-number validation failures, e.g. ["Room 203 already exists"] */
  errors: string[];
}

export interface RoomBulkDeleteRequest {
  property_uid: string;
  room_uids: string[];
}

export interface RoomUpdateRequest {
  room_number?: string;
  type?: string;
  area_sqft?: number;
  status?: RoomStatus;
  zone_uid?: string | null;
  cleaning_note?: string;
  current_guest?: string;
}

export interface DormCreateRequest {
  property_uid: string;
  name: string;
  dorm_type: DormType;
  washroom: WashroomType;
  bed_count: number;
  zone_uid?: string | null;
  floor?: string;
  area_sqft?: number;
  description?: string;
}

export type DormUpdateRequest = Partial<
  Omit<import('../types').Dorm, 'dorm_uid' | 'property_uid' | 'beds' | 'created_at'>
>;

export interface BedStatusUpdateRequest {
  status: BedStatus;
  guest_name?: string;
}

/**
 * Bulk status transition — mirrors the multi-select bulk actions.
 * Backend may trigger automation rules (e.g. housekeeping task generation).
 */
export interface BulkUnitStatusRequest {
  action: 'checkout' | 'cleaning' | 'available' | 'maintenance';
  property_uid: string;
  room_uids?: string[];
  bed_uids?: string[];
}

export interface BulkUnitStatusResponse {
  rooms: import('../types').Room[];
  dorms: import('../types').Dorm[];
  /** Tasks auto-created by automation rules as a side effect */
  generated_tasks?: Task[];
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export interface EmployeeCreateRequest {
  property_uid: string;
  name: string;
  email: string;
  phone?: string;
  username?: string;
  /** Creates the staff login credential — the employee signs in with it */
  password: string;
  job_title: string;
  department: Employee['department'];
  zone_uid?: string | null;
  salary?: string;
  shift?: string;
  start_date?: string;
}

export interface EmployeeUpdateRequest {
  name?: string;
  job_title?: string;
  department?: Employee['department'];
  phone?: string;
  email?: string;
  zone_uid?: string | null;
  salary?: string;
  shift?: string;
  status?: Employee['status'];
}

export interface EmployeeZoneAssignRequest {
  zone_uid: string | null;
  /** Area-level assignment — mutually exclusive with zone_uid */
  area_uid?: string | null;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface TaskCreateRequest {
  property_uid: string;
  title: string;
  description?: string;
  task_type: TaskType;
  employee_uid?: string;
  supervisor_uid?: string | null;
  room_uid?: string | null;
  zone_uid?: string | null;
  priority?: TaskPriority;
  due_date?: string;
  due_time?: string;
  /** HH:MM — time of day each repetitive occurrence starts */
  start_time?: string;
  recurrence_start_date?: string;
  recurrence_end_date?: string;
  recurrence_window_end?: string;
  recurrence?: RecurrenceSchedule;
  recurrence_interval_days?: number;
  automation_rule?: {
    trigger: AutomationTrigger;
    scope_zone_uid?: string | null;
    template_title: string;
    template_description?: string;
    assign_to_uid?: string;
  };
}

export interface TaskUpdateRequest {
  title?: string;
  description?: string;
  task_type?: TaskType;
  employee_uid?: string;
  supervisor_uid?: string | null;
  room_uid?: string | null;
  zone_uid?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  due_date?: string;
  due_time?: string;
  start_time?: string;
  recurrence_start_date?: string;
  recurrence_end_date?: string;
  recurrence_window_end?: string;
  recurrence?: RecurrenceSchedule;
  recurrence_interval_days?: number;
  automation_rule?: Task['automation_rule'];
}

export interface TaskCompleteRequest {
  /** URLs returned by POST /media/uploads */
  photo_urls: string[];
  note?: string;
}

export interface TaskCompleteResponse {
  task: Task;
  /** Next instance when a repetitive task regenerates on completion */
  generated_task?: Task;
}

export interface TaskActionRequest {
  note?: string;
}

export interface TaskReassignRequest {
  employee_uid: string | null;
}

export interface TaskSubmitRequest {
  note?: string;
  photo_urls?: string[];
}

export interface TaskRejectRequest {
  reason: string;
}

// ---------------------------------------------------------------------------
// Maintenance tickets
// ---------------------------------------------------------------------------

export interface MaintenanceCreateRequest {
  property_uid: string;
  /** Exactly one of room_uid / dorm_uid / bed_uid must be provided. */
  room_uid?: string;
  dorm_uid?: string;
  bed_uid?: string;
  maintenance_type: string;
  issue: string;
  description?: string;
  priority?: MaintenancePriority;
  due_date?: string;
  attachment_urls?: string[];
}

// ---------------------------------------------------------------------------
// Work allocation batches — grouped ticket creation, one employee per zone
// ---------------------------------------------------------------------------

export interface WorkBatchTicketIn {
  kind: 'maintenance';
  room_uid?: string;
  dorm_uid?: string;
  bed_uid?: string;
  maintenance_type: string;
  issue: string;
  description?: string;
  priority?: MaintenancePriority;
  due_date?: string;
  attachment_urls?: string[];
}

export interface WorkBatchCreateRequest {
  property_uid: string;
  tickets: WorkBatchTicketIn[];
}

export interface WorkBatch {
  batch_id: string;
  batch_number: string; // WB-YYYY-NNNNN
  property_uid: string;
  zone_uid?: string | null;
  zone_name?: string;
  employee_uid?: string | null;
  employee_name?: string;
  work_type: string;
  allocation_status: 'auto_assigned' | 'unassigned' | string;
  allocation_reason?: string;
  created_by_name?: string;
  created_at?: string;
  tickets: import('../types').MaintenanceTicket[];
}

export interface WorkBatchCreateResponse {
  batches: WorkBatch[];
  total: number;
}

export interface MaintenanceUpdateRequest {
  maintenance_type?: string;
  issue?: string;
  description?: string;
  priority?: MaintenancePriority;
  due_date?: string;
  assigned_to?: string | null;
  status?: 'cancelled';
}

export interface MaintenanceAssignRequest {
  employee_uid: string | null;
}

export interface MaintenanceResolveRequest {
  resolution_notes: string;
  photo_urls?: string[];
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export interface UploadResponse {
  url: string;
}

// ---------------------------------------------------------------------------
// Work Templates — reusable operational definitions; backend scheduler owns
// generation (tasks/tickets) and the zone round-robin picks the employee.
// ---------------------------------------------------------------------------

export type TemplateType =
  | 'task' | 'maintenance' | 'inspection' | 'cleaning' | 'checklist' | 'other';
export type TemplateStatus = 'draft' | 'active' | 'paused' | 'archived';
export type AssignmentMode = 'team' | 'individual' | 'automatic';
export type LocationScope = 'property' | 'zone' | 'area' | 'rooms' | 'dorms' | 'beds';
export type ScheduleKind = 'one_time' | 'recurring';
export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

export interface TemplateAssignment {
  mode: AssignmentMode;
  team?: string;
  employee_uid?: string;
  supervisor_uid?: string;
  method?: 'zone_round_robin' | 'team_round_robin' | 'supervisor';
}

export interface TemplateLocation {
  scope: LocationScope;
  zone_uid?: string;
  area_uid?: string;
  room_uids?: string[];
  dorm_uids?: string[];
  bed_uids?: string[];
  /** dynamic expansion inside a zone/area: rooms | dorms | beds | units */
  target?: string;
}

export interface TemplateSchedule {
  kind: ScheduleKind;
  timezone?: string;
  date?: string;
  time?: string;
  end_time?: string;
  frequency?: ScheduleFrequency;
  every?: number;
  custom_unit?: 'days' | 'weeks' | 'months';
  start_time?: string;
  recurrence_start_date?: string;
  recurrence_end_date?: string;
  recurrence_window_end?: string;
  window_end?: string;
  weekdays?: number[]; // 0=Mon … 6=Sun
  day_of_month?: number;
  relative_week?: 'first' | 'second' | 'third' | 'fourth' | 'last';
  relative_weekday?: number;
  start_date?: string;
  end_date?: string;
}

export interface TemplateChecklistItem {
  title: string;
  description?: string;
  required: boolean;
}

export interface TemplateVerification {
  checklist_required?: boolean;
  photo_required?: boolean;
  min_photos?: number;
  max_photos?: number;
  supervisor_approval?: boolean;
  before_photo?: boolean;
  after_photo?: boolean;
}

export interface TemplateOverdue {
  actions: string[]; // mark_overdue|notify_supervisor|notify_manager|escalate|auto_reassign
  threshold_minutes?: number;
  reassign_method?: 'next_zone_employee' | 'supervisor' | 'manual';
}

export interface TemplateNotifications {
  notify_on_assignment?: boolean;
  notify_on_completion?: boolean;
  notify_on_overdue?: boolean;
  remind_before_minutes?: number;
}

export interface WorkTemplate {
  template_uid: string;
  property_uid: string;
  name: string;
  template_type: TemplateType;
  description?: string;
  category?: string;
  priority: TaskPriority;
  duration_minutes?: number;
  status: TemplateStatus;
  version: number;
  assignment: TemplateAssignment;
  location: TemplateLocation;
  schedule: TemplateSchedule;
  checklist: TemplateChecklistItem[];
  verification: TemplateVerification;
  overdue: TemplateOverdue;
  notifications: TemplateNotifications;
  next_run_at?: string;
  last_run_at?: string;
  generated_count: number;
  created_by_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface WorkTemplateCreateRequest {
  property_uid: string;
  name: string;
  template_type: TemplateType;
  description?: string;
  category?: string;
  priority?: TaskPriority;
  duration_minutes?: number;
  status?: TemplateStatus;
  assignment?: TemplateAssignment;
  location?: TemplateLocation;
  schedule?: TemplateSchedule;
  checklist?: TemplateChecklistItem[];
  verification?: TemplateVerification;
  overdue?: TemplateOverdue;
  notifications?: TemplateNotifications;
}

export type WorkTemplateUpdateRequest = Partial<
  Omit<WorkTemplateCreateRequest, 'property_uid'>
>;

export interface TemplateGenerationRow {
  occurrence_key: string;
  ticket_kind: 'maintenance' | 'task';
  ticket_number?: string;
  target_label?: string;
  created_at?: string;
}

export interface WorkTemplateGeneratedWork {
  tasks: import('../types').Task[];
  maintenance: import('../types').MaintenanceTicket[];
}

// ---------------------------------------------------------------------------
// Task operations — Today's Tasks (scheduled + generated) vs Task History
// (actual generated instances only). Backend is the source of truth for
// generation_state vs work_status.
// ---------------------------------------------------------------------------

export interface TodayTaskItem {
  item_type: 'task' | 'occurrence';
  occurrence_key?: string;
  template_uid?: string;
  template_name?: string;
  template_version?: number;
  title: string;
  source: 'template' | 'manual' | 'recurring' | 'one_time';
  priority: TaskPriority;
  scheduled_at?: string;
  zone_name?: string;
  target_label?: string;
  room_number?: string;
  generation_state: 'generated' | 'pending_generation' | 'generation_failed' | 'cancelled';
  work_status?: string;
  task_uid?: string;
  ticket_number?: string;
  assignee?: string;
  assignment_mode?: string;
  allocation_method?: string;
}

export interface TodayTasksResponse {
  date: string;
  summary: {
    total_planned: number;
    generated: number;
    pending_generation: number;
    assigned: number;
    in_progress: number;
    completed: number;
    overdue: number;
    unassigned: number;
  };
  items: TodayTaskItem[];
}

export interface TaskHistoryItem {
  task_uid: string;
  ticket_number?: string;
  title: string;
  task_type: string;
  room_number?: string;
  zone_name?: string;
  assigned_to?: string;
  generated_at?: string;
  scheduled_for?: string;
  status: string;
  priority: TaskPriority;
  source: 'template' | 'recurring' | 'manual';
  template_uid?: string;
  template_version?: number;
  allocation_method?: string;
}

export interface TaskHistoryResponse {
  items: TaskHistoryItem[];
  pagination: { page: number; page_size: number; total: number; total_pages: number };
}

export interface TaskHistoryParams {
  property_uid?: string;
  date_from?: string;
  date_to?: string;
  zone_uid?: string;
  room_uid?: string;
  employee_uid?: string;
  status?: string;
  priority?: string;
  task_type?: string;
  source?: string;
  template_uid?: string;
  search?: string;
  page?: number;
  page_size?: number;
}

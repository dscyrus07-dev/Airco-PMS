/**
 * Wire types — mirror the FastAPI serializers 1:1.
 * Source of truth: backend/app/schemas/* (keys are snake_case, ids are *_uid strings).
 */

export type Role =
  | 'super_admin'
  | 'property_manager'
  | 'human_resource'
  | 'department_manager'
  | 'employee';

export interface User {
  uid: string;
  name: string;
  email: string;
  username: string;
  role: Role;
  company_uid: string;
  property_uid: string | null;
  employee_uid: string | null;
  zone_uid: string | null;
  phone: string | null;
  job_title: string | null;
  company_name: string | null;
}

export interface Company {
  company_uid: string;
  name: string;
  legal_name: string | null;
  brand_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  pin_code: string | null;
  operational_day_start: string;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: User;
  company: Company;
}

export interface MeResponse {
  user: User;
  company: Company;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'submitted'
  | 'reopened'
  | 'completed'
  | 'cancelled'
  | 'abandoned'
  | 'scheduled'
  | 'overdue';

export interface TaskHistoryEvent {
  event_uid: string;
  type: string;
  at: string;
  actor_name: string | null;
  note: string | null;
  photos: string[];
}

export interface CompletionImage {
  image_uid: string | null;
  task_uid: string;
  event_uid: string | null;
  submission_uid: string | null;
  url: string;
  file_name: string | null;
  created_by_name: string | null;
  created_at: string | null;
}

export interface CompletionSubmission {
  submission_uid: string;
  task_uid: string;
  event_uid: string | null;
  attempt_number: number;
  employee_uid: string | null;
  employee_name: string | null;
  submitted_at: string | null;
  status: string;
  reviewed_at: string | null;
  reviewer_uid: string | null;
  reviewed_by_name: string | null;
  review_comment: string | null;
  images: CompletionImage[];
}

/** Checklist item shape — backend ChecklistItem schema (template.checklist JSONB). */
export interface ChecklistItem {
  title: string;
  description?: string | null;
  required?: boolean;
}

/** Verification rules — backend VerificationConfig (template.verification JSONB). */
export interface VerificationConfig {
  mode?: string;
  checklist_required?: boolean;
  photo_required?: boolean;
  min_photos?: number;
  max_photos?: number;
  supervisor_approval?: boolean;
  before_photo?: boolean;
  after_photo?: boolean;
}

export interface Task {
  task_uid: string;
  ticket_number: string | null;
  property_uid: string;
  zone_uid: string | null;
  area_uid: string | null;
  room_uid: string | null;
  room_number: string | null;
  dorm_uid: string | null;
  dorm_name: string | null;
  bed_uids: string[] | null;
  washroom_uid: string | null;
  washroom_name: string | null;
  washroom_fixture_uid: string | null;
  washroom_fixture_label: string | null;
  supervisor_uid: string | null;
  supervisor_name: string | null;
  employee_uid: string | null;
  assigned_to_name: string | null;
  title: string;
  description: string | null;
  task_type: string;
  work_type: string | null;
  origin: string;
  status: TaskStatus;
  priority: string;
  due_date: string | null;
  due_time: string | null;
  start_time: string | null;
  scheduled_for: string | null;
  expires_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
  // Detail-only (populated by GET /tasks/{id})
  history?: TaskHistoryEvent[];
  completion_images?: CompletionImage[];
  completion_submissions?: CompletionSubmission[];
  checklist?: ChecklistItem[] | null;
  verification?: VerificationConfig | null;
}

export interface Zone {
  zone_uid: string;
  property_uid: string;
  area_uid: string | null;
  name: string;
  code: string | null;
  zone_type: string | null;
  floor: string | null;
  description: string | null;
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

export type TicketStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'on_hold'
  | 'resolved'
  | 'closed'
  | 'cancelled';

export interface TicketEvent {
  event_uid: string;
  action: string;
  actor_name: string | null;
  comment: string | null;
  at: string | null;
}

export interface TicketAttachment {
  attachment_uid: string;
  url: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  kind: string | null;
  attempt: number | null;
  uploaded_by_name: string | null;
  created_at: string | null;
}

export interface MaintenanceTicket {
  ticket_uid: string;
  ticket_number: string | null;
  company_uid: string;
  property_uid: string;
  room_uid: string | null;
  room_number: string | null;
  dorm_uid: string | null;
  dorm_name: string | null;
  bed_uid: string | null;
  bed_number: string | null;
  washroom_uid: string | null;
  washroom_name: string | null;
  washroom_fixture_uid: string | null;
  washroom_fixture_label: string | null;
  location_label: string | null;
  reported_by_name: string | null;
  maintenance_type: string;
  issue: string;
  description: string | null;
  priority: string;
  status: TicketStatus;
  assigned_to: string | null;
  assigned_to_name: string | null;
  zone_uid: string | null;
  due_date: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  resolution_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  events?: TicketEvent[];
  attachments?: TicketAttachment[];
}

export interface EligibleRoom {
  room_uid: string;
  room_number: string;
  type: string | null;
  zone_name: string | null;
}

export interface EligibleDorm {
  dorm_uid: string;
  name: string;
  dorm_type: string | null;
  zone_name: string | null;
  bed_count: number;
}

export interface EligibleLocations {
  rooms: EligibleRoom[];
  dorms: EligibleDorm[];
}

export interface MaintenanceCreatePayload {
  property_uid: string;
  room_uid?: string;
  dorm_uid?: string;
  bed_uid?: string;
  washroom_uid?: string;
  washroom_fixture_uid?: string;
  maintenance_type: string;
  issue: string;
  description?: string;
  priority?: string;
  due_date?: string;
  attachment_urls?: string[];
}

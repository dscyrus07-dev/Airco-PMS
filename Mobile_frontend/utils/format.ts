/**
 * Display formatting — IST (the company's operational timezone) and
 * employee-facing labels. Display-only; never feeds a request.
 */

import { TIME_ZONE } from '@/constants/config';
import type { Task, TaskStatus } from '@/types/api';

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
});

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const parse = (iso?: string | null): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const fmtTimeIST = (iso?: string | null): string => {
  const d = parse(iso);
  return d ? timeFmt.format(d) : '—';
};

export const fmtDateIST = (iso?: string | null): string => {
  const d = parse(iso);
  return d ? dateFmt.format(d) : '—';
};

export const fmtDateTimeIST = (iso?: string | null): string => {
  const d = parse(iso);
  return d ? dateTimeFmt.format(d) : '—';
};

const istDayKey = (d: Date): string => dayKeyFmt.format(d);

export const isTodayIST = (iso?: string | null): boolean => {
  const d = parse(iso);
  return d ? istDayKey(d) === istDayKey(new Date()) : false;
};

/** A date-only string ("2026-10-03") carries no time — showing one would
 *  fabricate 05:30 IST (UTC-midnight bug fixed on the web for the same reason). */
export const hasClockTime = (v?: string | null): boolean => !!v && v.includes('T');

/**
 * Effective display status — mirrors the web's getEffectiveTaskStatus:
 * terminal/review states pass through; live tasks past their due show overdue.
 */
export const effectiveStatus = (task: Pick<Task, 'status' | 'due_date'>): TaskStatus => {
  const s = task.status;
  if (s === 'completed' || s === 'scheduled' || s === 'cancelled' || s === 'abandoned') return s;
  if (s === 'overdue' || s === 'submitted' || s === 'reopened') return s;
  if (task.due_date) {
    const due = new Date(task.due_date);
    if (hasClockTime(task.due_date)) {
      if (due < new Date()) return 'overdue';
    } else if (istDayKey(due) < istDayKey(new Date())) {
      return 'overdue';
    }
  }
  return s;
};

export const isExpired = (task: Pick<Task, 'expires_at'>): boolean => {
  const d = parse(task.expires_at);
  return d ? d.getTime() < Date.now() : false;
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  pending: 'Queued',
  assigned: 'To do',
  in_progress: 'In progress',
  reopened: 'Rework',
  submitted: 'In review',
  completed: 'Done',
  cancelled: 'Cancelled',
  abandoned: 'Abandoned',
  scheduled: 'Scheduled',
  overdue: 'Overdue',
};

export const TICKET_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In progress',
  on_hold: 'On hold',
  resolved: 'Pending check',
  closed: 'Completed',
  cancelled: 'Cancelled',
};

/** Human label for a task's target — never raw uids or internal keys. */
export const taskLocation = (
  task: Pick<
    Task,
    'room_number' | 'dorm_name' | 'bed_uids' | 'washroom_name' | 'washroom_fixture_label'
  >,
  zoneName?: string | null
): string => {
  if (task.room_number) return `Room ${task.room_number}`;
  if (task.dorm_name) {
    const beds = task.bed_uids?.length ? ` · ${task.bed_uids.length} bed${task.bed_uids.length > 1 ? 's' : ''}` : '';
    return `${task.dorm_name}${beds}`;
  }
  if (task.washroom_name) {
    return task.washroom_fixture_label
      ? `${task.washroom_name} · ${task.washroom_fixture_label}`
      : task.washroom_name;
  }
  return zoneName ?? 'Common area';
};

export const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
  urgent: 'Urgent',
};

const HISTORY_LABELS: Record<string, string> = {
  created: 'Created',
  assigned: 'Assigned',
  reassigned: 'Reassigned',
  started: 'Started',
  submitted: 'Submitted for review',
  completed: 'Completed',
  rejected: 'Sent back for rework',
  reopened: 'Reopened',
  redo_requested: 'Redo requested',
  auto_abandoned: 'Expired unfinished',
  abandoned: 'Abandoned',
  cancelled: 'Cancelled',
};

export const historyLabel = (type: string): string => HISTORY_LABELS[type] ?? type.replaceAll('_', ' ');

const TICKET_EVENT_LABELS: Record<string, string> = {
  created: 'Reported',
  assigned: 'Assigned',
  reassigned: 'Reassigned',
  started: 'Work started',
  held: 'Put on hold',
  resumed: 'Resumed',
  resolved: 'Resolved — pending check',
  disapproved: 'Sent back',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const ticketEventLabel = (action: string): string =>
  TICKET_EVENT_LABELS[action] ?? action.replaceAll('_', ' ');

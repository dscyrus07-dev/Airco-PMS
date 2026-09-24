import { Task, TaskStatus, AutomationTrigger, RecurrenceSchedule } from '../types';

/**
 * Effective display status — a non-completed, non-rule task whose due date
 * has passed is shown as Overdue without needing a stored status update.
 * Timestamps (hourly tasks) are compared to the current time; plain dates
 * are compared to the start of today.
 */
export function getEffectiveTaskStatus(task: Task): TaskStatus {
  if (task.status === 'completed' || task.status === 'scheduled') return task.status;
  if (task.status === 'overdue') return 'overdue';
  if (task.due_date) {
    const due = new Date(task.due_date);
    let cmp: Date;
    if (task.due_date.includes('T')) {
      cmp = new Date();
    } else {
      cmp = new Date();
      cmp.setHours(0, 0, 0, 0);
    }
    if (due < cmp) return 'overdue';
  }
  return task.status || 'pending';
}

export const RECURRENCE_LABELS: Record<RecurrenceSchedule, string> = {
  hourly: 'Every hour',
  every_2_hours: 'Every 2 hours',
  every_6_hours: 'Every 6 hours',
  every_12_hours: 'Every 12 hours',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  custom: 'Custom interval',
};

export const isHourlySchedule = (schedule?: RecurrenceSchedule): boolean =>
  !!schedule && schedule !== 'custom' && schedule !== 'daily' &&
  schedule !== 'weekly' && schedule !== 'monthly';

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Open',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  submitted: 'Awaiting Review',
  reopened: 'Reopened',
  completed: 'Completed',
  cancelled: 'Cancelled',
  overdue: 'Overdue',
  scheduled: 'Scheduled',
};

export const TASK_TYPE_LABELS: Record<Task['task_type'], string> = {
  fixed: 'Fixed',
  repetitive: 'Repetitive',
  automated: 'Automated',
};

export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  bed_available_after_checkout: 'Bed becomes Available after checkout cleaning',
  bed_marked_cleaning: 'Bed is checked out (marked for cleaning)',
  room_checked_out: 'Room is checked out',
};

export function formatTaskDue(task: Task): string {
  if (!task.due_date) return '—';
  const date = new Date(task.due_date);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const label = isToday
    ? 'Today'
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return task.due_time ? `${label} · ${task.due_time}` : label;
}

export function formatEventTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

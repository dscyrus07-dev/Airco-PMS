import React, { ReactNode } from 'react';
import { RefreshCw, Zap, CheckCircle2, Clock, AlertCircle, CalendarClock, Pin } from 'lucide-react';
import { cn } from '../../lib/utils';
import { RoomStatus, BedStatus, TaskStatus, TaskType } from '../../types';
import { TASK_STATUS_LABELS, TASK_TYPE_LABELS } from '../../lib/taskUtils';

export interface BadgeProps {
  children: ReactNode;
  variant?: 'sage' | 'orange' | 'red' | 'lavender' | 'neutral' | 'outline';
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'md',
  className,
}) => {
  const sizeStyles = {
    sm: 'text-[11px] px-2 py-0.5 font-medium rounded-full',
    md: 'text-xs px-2.5 py-1 font-medium rounded-full',
  };

  const variantStyles = {
    sage: 'bg-[#EBF3EC] text-[#285230] border border-[#CEE4D1]',
    orange: 'bg-[#FEF3E8] text-[#9A4C07] border border-[#FCD9BD]',
    red: 'bg-[#FDE8E8] text-[#A32A2A] border border-[#F9C3C3]',
    lavender: 'bg-[#F2EFF9] text-[#554388] border border-[#DDD5F0]',
    neutral: 'bg-[#F3EFE9] text-[#48443D] border border-[#E2DDD5]',
    outline: 'bg-transparent text-[#575249] border border-[#DDD7CC]',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap leading-none transition-colors',
        sizeStyles[size],
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
};

// ---------------------------------------------------------------------------
// THE canonical resource visual resolver — the only place the UI decides a
// unit's color. It consumes the backend's two-axis state contract
// (`visual_state` emitted by ResourceStateService) and NEVER reconstructs
// state from task/ticket history.
//
//   maintenance              → red
//   cleaning                 → beige   (occupied + cleaning is STILL beige —
//                                       the operational blocker drives the
//                                       temporary visual state; occupancy is
//                                       an axis, not a color)
//   inactive                 → neutral
//   occupied + operational   → violet
//   unoccupied + available   → green
//   unknown / stale payload  → neutral + dev warning (never beige — a
//                              guessed color masks real data problems)
// ---------------------------------------------------------------------------
export type UnitVisualState = 'green' | 'purple' | 'beige' | 'red' | 'neutral';

export interface UnitStateInput {
  status: string;
  /** server-resolved axes — preferred source of truth */
  visual_state?: string | null;
  operational_state?: string | null;
  occupancy_state?: string | null;
  is_occupied?: boolean;
  /** legacy aliases still accepted for unserialized callers */
  occupied?: boolean;
  blocked?: boolean;
}

export function unitVisualState(input: UnitStateInput): UnitVisualState {
  // 1. the backend's canonical classification wins outright — the
  //    frontend must not reinterpret it
  switch (input.visual_state) {
    case 'maintenance':
      return 'red';
    case 'cleaning':
      return 'beige';
    case 'inactive':
      return 'neutral';
    case 'occupied':
      return 'purple';
    case 'available':
      return 'green';
  }
  // 2. fallback for objects serialized before the contract existed —
  //    derive from the two axes exactly like the backend does
  const operational =
    input.operational_state ??
    (input.status === 'occupied' ? 'available' : input.status);
  if (operational === 'inactive') return 'neutral';
  if (operational === 'maintenance') return 'red';
  if (operational === 'cleaning' || input.blocked) return 'beige';
  const occupied =
    input.is_occupied === true ||
    input.occupied === true ||
    input.occupancy_state === 'occupied' ||
    input.status === 'occupied';
  if (
    operational === 'available' ||
    operational === 'operational' ||
    operational === 'occupied'
  ) {
    return occupied ? 'purple' : 'green';
  }
  if (import.meta.env.DEV) {
    console.warn('unitVisualState: unrecognized resource state', input);
  }
  return 'neutral';
}

export const UNIT_VISUAL_TINT: Record<UnitVisualState, string> = {
  green: 'bg-[#EBF3EC] border-[#CEE4D1] text-[#244E2C]',
  purple: 'bg-[#F2EFF9] border-[#DDD5F0] text-[#554388]',
  beige: 'bg-[#FDF6EC] border-[#EFDDBE] text-[#7A540F]',
  red: 'bg-[#FDE8E8] border-[#F9C3C3] text-[#A32A2A]',
  neutral: 'bg-[#F3EFE9] border-[#E2DDD5] text-[#8C867C]',
};

/** Dot accent color per visual state — shared by every status list. */
export const UNIT_VISUAL_DOT: Record<UnitVisualState, string> = {
  green: 'bg-[#386641]',
  purple: 'bg-[#7C3AED]',
  beige: 'bg-[#D97706]',
  red: 'bg-[#C53B3B]',
  neutral: 'bg-[#A59F95]',
};

/** Text accent color per visual state. */
export const UNIT_VISUAL_TEXT: Record<UnitVisualState, string> = {
  green: 'text-[#2E6038]',
  purple: 'text-[#554388]',
  beige: 'text-[#9A4C07]',
  red: 'text-[#A32A2A]',
  neutral: 'text-[#736E65]',
};

/** Badge variant per visual state — status pills go through the resolver too. */
export const UNIT_VISUAL_BADGE_VARIANT: Record<
  UnitVisualState,
  BadgeProps['variant']
> = {
  green: 'sage',
  purple: 'lavender',
  beige: 'orange',
  red: 'red',
  neutral: 'neutral',
};

/** Canonical label per visual state. */
export const UNIT_VISUAL_LABEL: Record<UnitVisualState, string> = {
  green: 'Available',
  purple: 'Occupied',
  beige: 'Cleaning',
  red: 'Maintenance',
  neutral: 'Inactive',
};

export const RoomStatusBadge: React.FC<{ status: RoomStatus; size?: 'sm' | 'md' }> = ({
  status,
  size = 'sm',
}) => {
  switch (status) {
    case 'available':
      return (
        <Badge variant="sage" size={size}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#386641]" />
          Available
        </Badge>
      );
    case 'occupied':
      return (
        <Badge variant="lavender" size={size} className="bg-[#F2EFF9] text-[#554388] border-[#DDD5F0]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
          Occupied
        </Badge>
      );
    case 'cleaning':
      return (
        <Badge variant="orange" size={size} className="bg-[#FDF6EC] text-[#7A540F] border-[#EFDDBE]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#D6A017]" />
          Cleaning
        </Badge>
      );
    case 'maintenance':
      return (
        <Badge variant="red" size={size}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#C53B3B]" />
          Maintenance
        </Badge>
      );
    default:
      return <Badge size={size}>{status}</Badge>;
  }
};

export const BedStatusBadge: React.FC<{ status: BedStatus; size?: 'sm' | 'md' }> = ({
  status,
  size = 'sm',
}) => {
  switch (status) {
    case 'available':
      return (
        <Badge variant="sage" size={size}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#386641]" />
          Available
        </Badge>
      );
    case 'occupied':
      return (
        <Badge variant="lavender" size={size} className="bg-[#F2EFF9] text-[#554388] border-[#DDD5F0]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
          Occupied
        </Badge>
      );
    case 'cleaning':
      return (
        <Badge variant="orange" size={size} className="bg-[#FDF6EC] text-[#7A540F] border-[#EFDDBE]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#D6A017]" />
          Cleaning
        </Badge>
      );
    case 'maintenance':
      return (
        <Badge variant="red" size={size}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#C53B3B]" />
          Maintenance
        </Badge>
      );
    default:
      return <Badge size={size}>{status}</Badge>;
  }
};

export const TaskStatusBadge: React.FC<{ status: TaskStatus; size?: 'sm' | 'md' }> = ({
  status,
  size = 'sm',
}) => {
  switch (status) {
    case 'completed':
      return (
        <Badge variant="sage" size={size}>
          <CheckCircle2 className="w-3 h-3" />
          {TASK_STATUS_LABELS[status]}
        </Badge>
      );
    case 'in_progress':
      return (
        <Badge variant="orange" size={size}>
          <Clock className="w-3 h-3" />
          {TASK_STATUS_LABELS[status]}
        </Badge>
      );
    case 'pending':
      return (
        <Badge variant="orange" size={size} className="bg-[#FDF6EC] text-[#8A5A14] border-[#EFDDBE]">
          <Clock className="w-3 h-3" />
          {TASK_STATUS_LABELS[status]}
        </Badge>
      );
    case 'overdue':
      return (
        <Badge variant="red" size={size}>
          <AlertCircle className="w-3 h-3" />
          {TASK_STATUS_LABELS[status]}
        </Badge>
      );
    case 'scheduled':
      return (
        <Badge variant="lavender" size={size}>
          <CalendarClock className="w-3 h-3" />
          {TASK_STATUS_LABELS[status]}
        </Badge>
      );
    case 'assigned':
      return (
        <Badge variant="lavender" size={size}>
          <CheckCircle2 className="w-3 h-3" />
          {TASK_STATUS_LABELS[status]}
        </Badge>
      );
    case 'submitted':
      return (
        <Badge variant="lavender" size={size} className="bg-[#EAF1FB] text-[#2C4A7C] border-[#C9D8F0]">
          <Clock className="w-3 h-3" />
          {TASK_STATUS_LABELS[status]}
        </Badge>
      );
    case 'reopened':
      return (
        <Badge variant="orange" size={size}>
          <AlertCircle className="w-3 h-3" />
          {TASK_STATUS_LABELS[status]}
        </Badge>
      );
    case 'cancelled':
      return (
        <Badge variant="neutral" size={size}>
          {TASK_STATUS_LABELS[status]}
        </Badge>
      );
    case 'abandoned':
      return (
        <Badge variant="red" size={size} className="bg-[#F6E9E4] text-[#8C4A2F] border-[#EAD2C5]">
          <AlertCircle className="w-3 h-3" />
          {TASK_STATUS_LABELS[status]}
        </Badge>
      );
    default:
      return <Badge size={size}>{status}</Badge>;
  }
};

export const TaskTypeBadge: React.FC<{ type: TaskType; size?: 'sm' | 'md' }> = ({
  type,
  size = 'sm',
}) => {
  switch (type) {
    case 'repetitive':
      return (
        <Badge variant="lavender" size={size}>
          <RefreshCw className="w-3 h-3" />
          {TASK_TYPE_LABELS[type]}
        </Badge>
      );
    case 'automated':
      return (
        <Badge variant="lavender" size={size} className="bg-[#EFF0FA] text-[#3F4C8C] border-[#D5DAF0]">
          <Zap className="w-3 h-3" />
          {TASK_TYPE_LABELS[type]}
        </Badge>
      );
    case 'fixed':
    default:
      return (
        <Badge variant="neutral" size={size}>
          <Pin className="w-3 h-3" />
          {TASK_TYPE_LABELS[type]}
        </Badge>
      );
  }
};


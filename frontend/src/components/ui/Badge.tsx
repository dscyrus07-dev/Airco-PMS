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
        <Badge variant="neutral" size={size} className="bg-[#EEF2F6] text-[#254668] border-[#CFDCEB]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
          Occupied
        </Badge>
      );
    case 'cleaning':
      return (
        <Badge variant="orange" size={size}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#D97706]" />
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
        <Badge variant="neutral" size={size} className="bg-[#EEF2F6] text-[#254668] border-[#CFDCEB]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
          Occupied
        </Badge>
      );
    case 'cleaning':
      return (
        <Badge variant="orange" size={size}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#D97706]" />
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


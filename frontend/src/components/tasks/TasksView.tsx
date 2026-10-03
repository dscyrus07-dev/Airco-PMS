import React, { useEffect, useState } from 'react';
import { CalendarCheck, CalendarDays, ClipboardCheck, History, OctagonX, Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { usePolling } from '../../hooks/usePolling';
import { Button } from '../ui/Button';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import { CreateTaskModal } from './CreateTaskModal';
import { TaskDetailDrawer } from './TaskDetailDrawer';
import { TodayTasksView } from './TodayTasksView';
import { TaskHistoryView } from './TaskHistoryView';
import { TaskCalendarView } from './TaskCalendarView';
import { PendingCheckView } from './PendingCheckView';
import { AbandonedTodayView } from './AbandonedTodayView';
import { BackButton } from '../ui/BackButton';
import { Task } from '../../types';

/**
 * Task workspace — two fundamentally different views:
 *
 *   Today's Tasks = "what work is supposed to happen today"
 *     (generated instances + scheduled template occurrences not yet generated)
 *   Task History  = "what actual task instances have been generated"
 *     (the tasks table — nothing appears here before it exists as a task)
 */
export const TasksView: React.FC = () => {
  const {
    currentPropertyTasks, currentUser, canDo, deleteTask, activePropertyUid, navigate,
    pendingCheck, refreshPendingCheck,
  } = useApp();

  const [tab, setTab] = useState<'today' | 'abandoned' | 'pending' | 'history' | 'calendar'>('today');
  const canReview = currentUser?.role !== 'employee';
  const isSuperAdmin = currentUser?.role === 'super_admin';

  // Pending Check badge — shared AppContext snapshot; this view is the
  // sole 30s poller (PendingCheckView reads the same data, no second fetch)
  const pendingCount = pendingCheck?.count ?? 0;
  useEffect(() => {
    if (canReview) void refreshPendingCheck();
  }, [canReview, refreshPendingCheck]);
  usePolling(
    () => refreshPendingCheck(),
    30000,
    canReview,
    'TasksView.pendingCheck'
  );
  const [selectedTaskUid, setSelectedTaskUid] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);

  const selectedTask =
    currentPropertyTasks.find((t) => t.task_uid === selectedTaskUid) || null;
  const canCreate = canDo('create', 'tasks') && currentUser?.role !== 'employee';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="mb-2">
            <BackButton to={`/property/${activePropertyUid}/zones`} />
          </div>
          <h1 className="font-display font-bold text-2xl sm:text-[28px] text-[#24221F] tracking-tight">
            Tasks
          </h1>
          <p className="font-body text-sm text-[#6C675F] mt-1">
            Today's operational schedule and generated work history
          </p>
        </div>
        {canCreate && (
          <Button
            variant="primary"
            onClick={() => {
              setEditingTask(null);
              setCreateOpen(true);
            }}
            className="self-start sm:self-auto gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Add Task</span>
          </Button>
        )}
      </div>

      {/* Section nav — Today's schedule vs pending review vs history */}
      <div className="flex items-center gap-1 bg-[#F0EDE6] rounded-[12px] p-1 w-fit">
        {([
          { v: 'today' as const, l: "Today's Tasks", icon: CalendarCheck },
          { v: 'abandoned' as const, l: "Today's Abandoned", icon: OctagonX },
          ...(canReview ? [{ v: 'pending' as const, l: 'Pending Check', icon: ClipboardCheck, count: pendingCount }] : []),
          { v: 'history' as const, l: 'Task History', icon: History },
          ...(isSuperAdmin ? [{ v: 'calendar' as const, l: 'Calendar', icon: CalendarDays }] : []),
        ]).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              className={`flex items-center gap-2 px-4 py-2 rounded-[9px] text-[13px] font-semibold transition-all cursor-pointer ${
                tab === t.v
                  ? 'bg-white text-[#24221F] shadow-sm'
                  : 'text-[#6C675F] hover:text-[#24221F]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.l}
              {'count' in t && t.count !== undefined && (
                <span className={`ml-1 min-w-[18px] px-1 rounded-full text-[11px] font-bold text-center ${
                  t.count > 0 ? 'bg-[#B4540A] text-white' : 'bg-[#E4DFD5] text-[#8A857B]'
                }`}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'today' ? (
        <TodayTasksView onOpenTask={setSelectedTaskUid} />
      ) : tab === 'abandoned' ? (
        <AbandonedTodayView onOpenTask={setSelectedTaskUid} />
      ) : tab === 'pending' ? (
        <PendingCheckView
          onOpenTask={(uid, kind) =>
            kind === 'maintenance'
              ? navigate(`/property/${activePropertyUid}/maintenance?ticket=${uid}`)
              : setSelectedTaskUid(uid)
          }
        />
      ) : tab === 'calendar' ? (
        <TaskCalendarView />
      ) : (
        <TaskHistoryView onOpenTask={setSelectedTaskUid} />
      )}

      <TaskDetailDrawer
        task={selectedTask}
        onClose={() => setSelectedTaskUid(null)}
      />
      <CreateTaskModal
        isOpen={createOpen || !!editingTask}
        onClose={() => {
          setCreateOpen(false);
          setEditingTask(null);
        }}
        editTask={editingTask}
      />
      <ConfirmationDialog
        isOpen={!!deletingTask}
        onClose={() => setDeletingTask(null)}
        onConfirm={() => {
          if (deletingTask) deleteTask(deletingTask.task_uid);
        }}
        entityType="Task"
        entityName={deletingTask?.title || ''}
        impactMessage="The task and its full history — including any photo evidence — will be permanently removed."
      />
    </div>
  );
};

export default TasksView;

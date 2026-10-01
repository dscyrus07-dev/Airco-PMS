import React, { useMemo, useState } from 'react';
import {
  CheckSquare, Layers, Wrench, Activity, ClipboardCheck, History,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Badge, TaskStatusBadge, TaskTypeBadge } from '../ui/Badge';
import { TaskDetailDrawer } from '../tasks/TaskDetailDrawer';
import { MaintStatusPill, PriorityPill, TicketDrawer } from '../maintenance/MaintenanceView';
import { Task, TaskStatus } from '../../types';
import { formatTaskDue, getEffectiveTaskStatus } from '../../lib/taskUtils';

// Live = work still actionable by the employee; submitted = awaiting PM
// approval; completed = terminal record (completed/cancelled).
const LIVE_TASK_STATUSES: TaskStatus[] = [
  'pending', 'assigned', 'in_progress', 'reopened', 'overdue', 'scheduled',
];
const LIVE_TICKET_STATUSES = ['open', 'assigned', 'in_progress', 'on_hold'];

export const EmployeeTasksView: React.FC = () => {
  const { currentEmployeeTasks, currentEmployeeMaintenance, zones, employeeRecord } = useApp();

  const [view, setView] = useState<'live' | 'submitted' | 'completed'>('live');
  const [selectedTaskUid, setSelectedTaskUid] = useState<string | null>(null);
  const [selectedTicketUid, setSelectedTicketUid] = useState<string | null>(null);

  const zoneName = (uid?: string | null) =>
    uid ? zones.find((z) => z.zone_uid === uid)?.name || '—' : '—';

  const filteredTasks = useMemo(() => {
    return currentEmployeeTasks.filter((t) => {
      const st = getEffectiveTaskStatus(t);
      if (view === 'live') return LIVE_TASK_STATUSES.includes(st);
      if (view === 'submitted') return st === 'submitted';
      return st === 'completed' || st === 'cancelled';
    });
  }, [currentEmployeeTasks, view]);

  const filteredTickets = useMemo(() => {
    return currentEmployeeMaintenance.filter((t) => {
      if (view === 'live') return LIVE_TICKET_STATUSES.includes(t.status);
      if (view === 'submitted') return t.status === 'resolved';
      return t.status === 'closed' || t.status === 'cancelled';
    });
  }, [currentEmployeeMaintenance, view]);

  const selectedTask = currentEmployeeTasks.find((t) => t.task_uid === selectedTaskUid) || null;
  const selectedTicket =
    currentEmployeeMaintenance.find((t) => t.ticket_uid === selectedTicketUid) || null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="font-display font-bold text-2xl sm:text-[28px] text-[#24221F] tracking-tight">
            My Tasks
          </h1>
          <Badge variant="sage" size="md">
            {currentEmployeeTasks.length + currentEmployeeMaintenance.length} Assigned
          </Badge>
        </div>
        <p className="font-body text-sm text-[#6C675F] mt-1">
          Tasks assigned to {employeeRecord?.name || 'you'} — tap a task to start work or submit
          completion evidence
        </p>
      </div>

      {/* Section nav — live work vs pending approval vs terminal record */}
      <div className="flex items-center gap-1 bg-[#F0EDE6] rounded-[12px] p-1 w-fit">
        {([
          { v: 'live' as const, l: 'Current Live', icon: Activity },
          { v: 'submitted' as const, l: 'Submitted for Approval', icon: ClipboardCheck },
          { v: 'completed' as const, l: 'Completed', icon: History },
        ]).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.v}
              onClick={() => setView(t.v)}
              className={`flex items-center gap-2 px-4 py-2 rounded-[9px] text-[13px] font-semibold transition-all cursor-pointer ${
                view === t.v
                  ? 'bg-white text-[#24221F] shadow-sm'
                  : 'text-[#6C675F] hover:text-[#24221F]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.l}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {filteredTasks.length === 0 && filteredTickets.length === 0 ? (
        <Card className="p-12 text-center border-dashed border-[#D9D3C7]">
          <div className="w-12 h-12 rounded-full bg-[#EBF3EC] text-[#386641] flex items-center justify-center mx-auto mb-3">
            <CheckSquare className="w-6 h-6" />
          </div>
          <h3 className="font-display font-semibold text-lg text-[#24221F]">
            {view === 'live'
              ? 'Nothing assigned to you right now'
              : view === 'submitted'
                ? 'Nothing awaiting approval'
                : 'No completed work yet'}
          </h3>
          <p className="font-body text-sm text-[#6C675F] max-w-sm mx-auto mt-1">
            {view === 'live'
              ? 'New tasks from your property manager will appear here.'
              : view === 'submitted'
                ? 'Work you submit for review appears here until it is approved.'
                : 'Completed and cancelled work is archived here.'}
          </p>
        </Card>
      ) : filteredTasks.length > 0 ? (
        <>
          {/* Desktop table */}
          <Card className="p-0 overflow-hidden hidden md:block">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="bg-[#FAF8F5] border-b border-[#EAE5DC] text-left">
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#736E65] uppercase tracking-wider">
                    Task ID
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#736E65] uppercase tracking-wider">
                    Title
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#736E65] uppercase tracking-wider">
                    Zone
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#736E65] uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#736E65] uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-[#736E65] uppercase tracking-wider">
                    Due
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2ECE3]">
                {filteredTasks.map((task) => {
                  const st = getEffectiveTaskStatus(task);
                  return (
                    <tr
                      key={task.task_uid}
                      onClick={() => setSelectedTaskUid(task.task_uid)}
                      className="hover:bg-[#FAF8F5] cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-[11px] font-semibold text-[#736E65]">
                          {task.ticket_number || task.task_uid}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[300px]">
                        <p className="font-medium text-[13px] text-[#24221F] truncate">
                          {task.title}
                        </p>
                        {task.description && (
                          <p className="text-[11px] text-[#8C867C] truncate mt-0.5">
                            {task.description}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-[#555047] whitespace-nowrap inline-flex items-center gap-1">
                          <Layers className="w-3 h-3 text-[#8C867C]" />
                          {zoneName(task.zone_uid)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <TaskTypeBadge type={task.task_type} />
                      </td>
                      <td className="px-4 py-3">
                        <TaskStatusBadge status={st} />
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs whitespace-nowrap ${
                            st === 'overdue' ? 'text-[#A32A2A] font-semibold' : 'text-[#555047]'
                          }`}
                        >
                          {formatTaskDue(task)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {/* Mobile stacked cards */}
          <div className="md:hidden space-y-3">
            {filteredTasks.map((task) => {
              const st = getEffectiveTaskStatus(task);
              return (
                <Card
                  key={task.task_uid}
                  className="p-4"
                  onClick={() => setSelectedTaskUid(task.task_uid)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-[#24221F] leading-tight">
                        {task.title}
                      </p>
                      <span className="font-mono text-[10px] font-semibold text-[#8C867C]">
                        {task.ticket_number || task.task_uid}
                      </span>
                    </div>
                    <TaskStatusBadge status={st} />
                  </div>
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <TaskTypeBadge type={task.task_type} />
                    <span className="text-[11px] text-[#736E65]">{zoneName(task.zone_uid)}</span>
                  </div>
                  <p
                    className={`text-[11px] mt-2 ${
                      st === 'overdue' ? 'text-[#A32A2A] font-semibold' : 'text-[#736E65]'
                    }`}
                  >
                    Due: {formatTaskDue(task)}
                  </p>
                </Card>
              );
            })}
          </div>
        </>
      ) : null}

      {/* Maintenance tickets assigned to me */}
      {filteredTickets.length > 0 && (
        <div>
          <h2 className="font-display font-semibold text-lg text-[#24221F] mb-3">
            Maintenance Tickets
          </h2>
          <div className="grid gap-3">
            {filteredTickets.map((t) => (
              <Card
                key={t.ticket_uid}
                hoverEffect
                onClick={() => setSelectedTicketUid(t.ticket_uid)}
                className="p-4 cursor-pointer"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 ${
                        t.priority === 'critical'
                          ? 'bg-[#FBEBEB] text-[#A32A2A]'
                          : 'bg-[#FDF0E5] text-[#9A4C07]'
                      }`}
                    >
                      <Wrench className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-sm text-[#24221F]">
                          {t.ticket_number}
                        </span>
                        <MaintStatusPill status={t.status} />
                        <PriorityPill priority={t.priority} />
                      </div>
                      <p className="text-xs text-[#555047] mt-0.5 truncate">
                        {t.issue}
                        {t.description && (
                          <span className="text-[#8C867C]"> · {t.description}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-[#8C867C] shrink-0">
                    <p className="font-semibold text-[#555047]">
                      {t.location_label || t.room_number || '—'}
                    </p>
                    {t.due_date && <p>Due {t.due_date}</p>}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Shared detail drawer — employee sees Start / Mark Complete with photo */}
      <TaskDetailDrawer task={selectedTask} onClose={() => setSelectedTaskUid(null)} />
      {selectedTicket && (
        <TicketDrawer ticket={selectedTicket} onClose={() => setSelectedTicketUid(null)} />
      )}
    </div>
  );
};

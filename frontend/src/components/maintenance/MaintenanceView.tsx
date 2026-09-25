import React, { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Wrench,
  AlertTriangle,
  Flame,
  CheckCircle2,
  Clock,
  Camera,
  Pause,
  X,
  Filter,
  Search,
  Ticket,
  UserCheck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Drawer } from '../ui/Drawer';
import { MaintenanceTicket } from '../../types';
import * as mediaApi from '../../api/media';
import {
  MAINTENANCE_STATUS_LABELS,
  MAINTENANCE_TYPE_OPTIONS,
  PRIORITY_LABELS,
  isActiveTicket,
} from '../../lib/maintenanceUtils';
import { formatEventTime } from '../../lib/taskUtils';

const PRIORITY_STYLES: Record<string, string> = {
  low: 'bg-[#F4F0E8] text-[#6C675F]',
  medium: 'bg-[#EAF1FB] text-[#2C4A7C]',
  high: 'bg-[#FDF0E5] text-[#9A4C07]',
  critical: 'bg-[#FBEBEB] text-[#A32A2A]',
};

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-[#FDF0E5] text-[#9A4C07]',
  assigned: 'bg-[#EAF1FB] text-[#2C4A7C]',
  in_progress: 'bg-[#FDF0E5] text-[#B45309]',
  on_hold: 'bg-[#F4F0E8] text-[#6C675F]',
  resolved: 'bg-[#EBF3EC] text-[#386641]',
  closed: 'bg-[#EDEAE4] text-[#555047]',
  cancelled: 'bg-[#EDEAE4] text-[#8C867C]',
};

export const PriorityPill: React.FC<{ priority: string }> = ({ priority }) => (
  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${PRIORITY_STYLES[priority] || PRIORITY_STYLES.low}`}>
    {PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS] || priority}
  </span>
);

export const MaintStatusPill: React.FC<{ status: string }> = ({ status }) => (
  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLES[status] || STATUS_STYLES.open}`}>
    {MAINTENANCE_STATUS_LABELS[status as keyof typeof MAINTENANCE_STATUS_LABELS] || status}
  </span>
);

const typeLabel = (v: string) =>
  MAINTENANCE_TYPE_OPTIONS.find((o) => o.value === v)?.label || v;

// ---------------------------------------------------------------------------
// Detail drawer — full ticket + timeline + workflow actions
// ---------------------------------------------------------------------------

export const TicketDrawer: React.FC<{
  ticket: MaintenanceTicket;
  onClose: () => void;
}> = ({ ticket, onClose }) => {
  const {
    currentPropertyEmployees,
    currentPropertyMaintenance,
    activeProperty,
    currentRole,
    assignMaintenanceTicket,
    holdMaintenanceTicket,
    resolveMaintenanceTicket,
    closeMaintenanceTicket,
    disapproveMaintenanceTicket,
    addToast,
  } = useApp();

  const [assignee, setAssignee] = useState(ticket.assigned_to || '');
  const [resolveMode, setResolveMode] = useState(false);
  const [disapproveMode, setDisapproveMode] = useState(false);
  const [disapproveReason, setDisapproveReason] = useState('');
  const [resolveNotes, setResolveNotes] = useState('');
  const [resolvePhotos, setResolvePhotos] = useState<{ file: File; previewUrl: string }[]>([]);
  const [isWorking, setIsWorking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Other tickets on the SAME target (room / dorm / bed) — nulls never match
  const roomHistory = currentPropertyMaintenance.filter(
    (t) =>
      t.ticket_uid !== ticket.ticket_uid &&
      ((t.room_uid && t.room_uid === ticket.room_uid) ||
        (t.bed_uid && t.bed_uid === ticket.bed_uid) ||
        (t.dorm_uid && !t.bed_uid && t.dorm_uid === ticket.dorm_uid && !ticket.bed_uid))
  );

  // assign / hold / close hit Staff-gated endpoints — employees may only
  // start and resolve tickets assigned to them.
  const isStaff = currentRole !== 'employee';
  const canAssign = isStaff && isActiveTicket(ticket.status);
  const canHold = isStaff && ['open', 'assigned', 'in_progress'].includes(ticket.status);
  const canResolve = !['resolved', 'closed', 'cancelled'].includes(ticket.status);
  const canClose = isStaff && ticket.status === 'resolved';
  const canDisapprove = isStaff && ticket.status === 'resolved';

  const doResolve = async () => {
    if (resolveNotes.trim().length < 3) {
      addToast({ type: 'warning', title: 'Resolution notes required' });
      return;
    }
    setIsWorking(true);
    try {
      const urls: string[] = [];
      for (const p of resolvePhotos) {
        const res = await mediaApi.uploadPhoto(p.file);
        urls.push(res.url);
      }
      await resolveMaintenanceTicket(ticket.ticket_uid, resolveNotes.trim(), urls);
      setResolveMode(false);
    } finally {
      setIsWorking(false);
    }
  };

  const ACTION_LABELS: Record<string, string> = {
    created: 'Ticket created',
    assigned: 'Assigned',
    started: 'Work started',
    held: 'Put on hold',
    resumed: 'Resumed',
    resolved: 'Marked resolved',
    closed: 'Ticket closed',
    cancelled: 'Cancelled',
    edited: 'Details edited',
    commented: 'Comment added',
  };

  return (
    <Drawer isOpen onClose={onClose} title={ticket.ticket_number}>
      <div className="space-y-5">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <MaintStatusPill status={ticket.status} />
            <PriorityPill priority={ticket.priority} />
            <Badge variant="neutral" size="sm">{typeLabel(ticket.maintenance_type)}</Badge>
          </div>
          <h3 className="font-display font-bold text-lg text-[#24221F] mt-2">
            {ticket.issue}
          </h3>
          <p className="text-xs text-[#736E65] mt-0.5">
            {ticket.location_label || `Room ${ticket.room_number || '—'}`} · {activeProperty?.name}
          </p>
          {ticket.description && (
            <p className="text-sm text-[#555047] mt-2 leading-relaxed">{ticket.description}</p>
          )}
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-[10px] bg-[#FAF8F5] border border-[#EDE8DF]">
            <p className="text-[#8C867C] uppercase tracking-wider text-[10px] font-semibold">Reported By</p>
            <p className="text-[#24221F] font-medium mt-0.5">{ticket.reported_by_name || '—'}</p>
          </div>
          <div className="p-3 rounded-[10px] bg-[#FAF8F5] border border-[#EDE8DF]">
            <p className="text-[#8C867C] uppercase tracking-wider text-[10px] font-semibold">Reported At</p>
            <p className="text-[#24221F] font-medium mt-0.5">{formatEventTime(ticket.created_at || '')}</p>
          </div>
          <div className="p-3 rounded-[10px] bg-[#FAF8F5] border border-[#EDE8DF]">
            <p className="text-[#8C867C] uppercase tracking-wider text-[10px] font-semibold">Due Date</p>
            <p className="text-[#24221F] font-medium mt-0.5">{ticket.due_date || '—'}</p>
          </div>
          <div className="p-3 rounded-[10px] bg-[#FAF8F5] border border-[#EDE8DF]">
            <p className="text-[#8C867C] uppercase tracking-wider text-[10px] font-semibold">Resolved</p>
            <p className="text-[#24221F] font-medium mt-0.5">{ticket.resolved_at ? formatEventTime(ticket.resolved_at) : '—'}</p>
          </div>
        </div>

        {ticket.resolution_notes && (
          <div className="p-3 rounded-[10px] bg-[#EBF3EC] border border-[#CFE4D1] text-sm text-[#244E2C]">
            <p className="text-[10px] uppercase tracking-wider font-bold mb-0.5">Resolution</p>
            {ticket.resolution_notes}
          </div>
        )}

        {/* Attachments */}
        {ticket.attachments.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-[#8C867C] uppercase tracking-wider mb-2">
              Attachments ({ticket.attachments.length})
            </p>
            <div className="flex gap-2 flex-wrap">
              {ticket.attachments.map((a) => (
                <a key={a.attachment_uid} href={a.url} target="_blank" rel="noreferrer"
                   className="block w-16 h-16 rounded-[10px] overflow-hidden border border-[#E5E0D6] hover:border-[#386641] transition-colors">
                  <img src={a.url} alt={a.file_name || ''} className="w-full h-full object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Assignment */}
        {canAssign && (
          <div>
            <p className="text-[10px] font-semibold text-[#8C867C] uppercase tracking-wider mb-1.5">
              Assign To
            </p>
            {/* How this assignee was chosen — auto round-robin vs manual */}
            {ticket.allocation_method && (
              <p className="text-[11px] text-[#8C867C] mb-1.5">
                {ticket.allocation_method === 'round_robin'
                  ? `Auto-assigned via zone round-robin${ticket.allocation_batch_id ? '' : ''}`
                  : ticket.allocation_method === 'reassign'
                    ? 'Manually reassigned'
                    : 'Manually assigned'}
                {ticket.allocation_reason === 'no_eligible_employee' &&
                  ' — no eligible employee in zone'}
                {ticket.allocation_reason === 'no_zone' && ' — room has no zone'}
              </p>
            )}
            <div className="flex gap-2">
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="flex-1 px-3 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#386641]/25"
              >
                <option value="">Unassigned</option>
                {currentPropertyEmployees
                  .filter((e) => e.status === 'Active')
                  .map((e) => (
                    <option key={e.employee_uid} value={e.employee_uid}>
                      {e.name} — {e.job_title}
                    </option>
                  ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  assignMaintenanceTicket(ticket.ticket_uid, assignee || null)
                }
              >
                <UserCheck className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Workflow actions */}
        {(canHold || canResolve || canClose) && (
          <div className="flex flex-wrap gap-2">
            {canHold && (
              <Button variant="outline" size="sm" onClick={() => holdMaintenanceTicket(ticket.ticket_uid)}>
                <Pause className="w-3.5 h-3.5 mr-1" /> Hold
              </Button>
            )}
            {canResolve && !resolveMode && (
              <Button variant="sage" size="sm" onClick={() => setResolveMode(true)}>
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Submit for Approval
              </Button>
            )}
            {canClose && (
              <Button variant="primary" size="sm" onClick={() => closeMaintenanceTicket(ticket.ticket_uid)}>
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve
              </Button>
            )}
            {canDisapprove && !disapproveMode && (
              <Button
                variant="outline" size="sm"
                onClick={() => setDisapproveMode(true)}
                className="text-[#A32A2A] border-[#F0C4C4] hover:bg-[#FDE8E8]"
              >
                <X className="w-3.5 h-3.5 mr-1" /> Disapprove
              </Button>
            )}
          </div>
        )}

        {/* Disapprove form — reason required, returns ticket for rework */}
        {disapproveMode && (
          <div className="p-3.5 rounded-[12px] border border-[#F0C4C4] bg-[#FDF6F6] space-y-3">
            <p className="text-xs font-semibold text-[#8A2B2B] uppercase tracking-wider">
              Disapprove Resolution
            </p>
            <textarea
              rows={3}
              value={disapproveReason}
              onChange={(e) => setDisapproveReason(e.target.value)}
              placeholder="e.g. Leak persists — please rework the joint."
              className="w-full px-3 py-2 bg-white border border-[#DDD7CB] rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#C53B3B]/25"
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDisapproveMode(false)}>Cancel</Button>
              <Button
                variant="primary" size="sm"
                disabled={disapproveReason.trim().length < 3}
                onClick={() => {
                  disapproveMaintenanceTicket(ticket.ticket_uid, disapproveReason.trim());
                  setDisapproveMode(false);
                  setDisapproveReason('');
                }}
              >
                Submit Disapproval
              </Button>
            </div>
          </div>
        )}

        {/* Resolve form */}
        {resolveMode && (
          <div className="p-3.5 rounded-[12px] border border-[#CFE4D1] bg-[#F7FBF7] space-y-3">
            <p className="text-xs font-semibold text-[#244E2C] uppercase tracking-wider">
              Resolution
            </p>
            <textarea
              rows={3}
              value={resolveNotes}
              onChange={(e) => setResolveNotes(e.target.value)}
              placeholder="e.g. Tap replaced and leakage tested."
              className="w-full px-3 py-2 bg-white border border-[#DDD7CB] rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#386641]/25"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                setResolvePhotos((prev) => [
                  ...prev,
                  ...files.map((f) => ({ file: f, previewUrl: URL.createObjectURL(f) })),
                ]);
                e.target.value = '';
              }}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-dashed border-[#C7C0B3] text-xs font-semibold text-[#555047] hover:border-[#386641] cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" /> Resolution Photo
              </button>
              {resolvePhotos.map((p, i) => (
                <div key={i} className="relative w-12 h-12 rounded-[8px] overflow-hidden border border-[#E5E0D6]">
                  <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setResolvePhotos((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setResolveMode(false)}>Cancel</Button>
              <Button variant="primary" size="sm" isLoading={isWorking} onClick={doResolve}>
                Submit Resolution
              </Button>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div>
          <p className="text-[10px] font-semibold text-[#8C867C] uppercase tracking-wider mb-2.5">
            Activity Timeline
          </p>
          <div className="space-y-0 relative before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-[#E5E0D6]">
            {ticket.events.map((e) => (
              <div key={e.event_uid} className="flex gap-3 py-2 relative">
                <span className="w-[15px] h-[15px] rounded-full bg-[#EBF3EC] border-2 border-[#386641] shrink-0 mt-0.5 relative z-10" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#24221F]">
                    {ACTION_LABELS[e.action] || e.action}
                    {e.actor_name && <span className="font-normal text-[#8C867C]"> · {e.actor_name}</span>}
                  </p>
                  <p className="text-[10px] text-[#8C867C]">{formatEventTime(e.at)}</p>
                  {e.comment && (
                    <p className="text-xs text-[#555047] mt-0.5">{e.comment}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Room maintenance history */}
        {roomHistory.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-[#8C867C] uppercase tracking-wider mb-2">
              {ticket.location_label || `Room ${ticket.room_number}`} — Maintenance History
            </p>
            <div className="space-y-1.5">
              {roomHistory.map((t) => (
                <div key={t.ticket_uid} className="flex items-center justify-between p-2.5 rounded-[10px] bg-[#FAF8F5] border border-[#EDE8DF] text-xs">
                  <div className="min-w-0">
                    <span className="font-mono font-semibold">{t.ticket_number}</span>
                    <span className="text-[#8C867C]"> · {typeLabel(t.maintenance_type)} · {t.issue}</span>
                  </div>
                  <MaintStatusPill status={t.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
};

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export const MaintenanceView: React.FC = () => {
  const { currentPropertyMaintenance, activeProperty } = useApp();
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [openedTicketUid, setOpenedTicketUid] = useState<string | null>(
    searchParams.get('ticket')
  );

  const tickets = currentPropertyMaintenance;

  const stats = useMemo(() => {
    const today = new Date().toDateString();
    return {
      open: tickets.filter((t) => t.status === 'open').length,
      inProgress: tickets.filter((t) => t.status === 'in_progress').length,
      high: tickets.filter((t) => t.priority === 'high' && isActiveTicket(t.status)).length,
      critical: tickets.filter((t) => t.priority === 'critical' && isActiveTicket(t.status)).length,
      resolvedToday: tickets.filter(
        (t) => t.resolved_at && new Date(t.resolved_at).toDateString() === today
      ).length,
    };
  }, [tickets]);

  const filtered = tickets.filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !t.ticket_number.toLowerCase().includes(q) &&
        !t.issue.toLowerCase().includes(q) &&
        !(t.location_label || t.room_number || '').toLowerCase().includes(q) &&
        !(t.assigned_to_name || '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const openedTicket = tickets.find((t) => t.ticket_uid === openedTicketUid) || null;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="font-display font-bold text-2xl sm:text-[28px] text-[#24221F] tracking-tight">
            Maintenance
          </h1>
          <Badge variant="sage" size="md">{tickets.length} Tickets</Badge>
        </div>
        <p className="font-body text-sm text-[#6C675F] mt-1">
          Ticket-based maintenance workflow for{' '}
          <strong className="text-[#24221F] font-semibold">{activeProperty?.name}</strong>
        </p>
      </div>

      {/* Stats — computed from the live ticket list */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Open Tickets', value: stats.open, icon: <Ticket className="w-4 h-4" />, tone: 'text-[#9A4C07] bg-[#FDF0E5]' },
          { label: 'In Progress', value: stats.inProgress, icon: <Clock className="w-4 h-4" />, tone: 'text-[#B45309] bg-[#FDF0E5]' },
          { label: 'High Priority', value: stats.high, icon: <Flame className="w-4 h-4" />, tone: 'text-[#C8681A] bg-[#FDF0E5]' },
          { label: 'Critical', value: stats.critical, icon: <AlertTriangle className="w-4 h-4" />, tone: 'text-[#A32A2A] bg-[#FBEBEB]' },
          { label: 'Resolved Today', value: stats.resolvedToday, icon: <CheckCircle2 className="w-4 h-4" />, tone: 'text-[#386641] bg-[#EBF3EC]' },
        ].map((s) => (
          <Card key={s.label} className="p-3.5">
            <div className={`w-8 h-8 rounded-[9px] flex items-center justify-center mb-2 ${s.tone}`}>
              {s.icon}
            </div>
            <p className="font-display font-bold text-xl text-[#24221F]">{s.value}</p>
            <p className="text-[11px] text-[#8C867C] font-medium">{s.label}</p>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-[#736E65]">
          <Search className="w-3.5 h-3.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticket, room, issue…"
            className="bg-[#FAF8F5] border border-[#DDD7CB] rounded-[8px] px-2.5 py-1.5 text-xs text-[#24221F] focus:outline-none w-56"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[#736E65]">
          <Filter className="w-3.5 h-3.5" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#FAF8F5] border border-[#DDD7CB] rounded-[8px] px-2 py-1.5 text-xs focus:outline-none"
          >
            <option value="all">All Statuses</option>
            {Object.entries(MAINTENANCE_STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Ticket list */}
      {filtered.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <div className="w-12 h-12 rounded-full bg-[#FDF0E5] text-[#9A4C07] flex items-center justify-center mx-auto mb-3">
            <Wrench className="w-6 h-6" />
          </div>
          <h3 className="font-display font-semibold text-lg text-[#24221F]">No maintenance tickets</h3>
          <p className="font-body text-sm text-[#6C675F] max-w-md mx-auto mt-1">
            Flag a room for maintenance from the Rooms page — the ticket appears here.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((t) => (
            <Card
              key={t.ticket_uid}
              hoverEffect
              onClick={() => setOpenedTicketUid(t.ticket_uid)}
              className="p-4 cursor-pointer"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 ${
                    t.priority === 'critical' ? 'bg-[#FBEBEB] text-[#A32A2A]' : 'bg-[#FDF0E5] text-[#9A4C07]'
                  }`}>
                    <Wrench className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-sm text-[#24221F]">{t.ticket_number}</span>
                      <MaintStatusPill status={t.status} />
                      <PriorityPill priority={t.priority} />
                    </div>
                    <p className="text-xs text-[#555047] mt-0.5 truncate">
                      {t.issue} <span className="text-[#8C867C]">· {typeLabel(t.maintenance_type)}</span>
                    </p>
                  </div>
                </div>
                <div className="text-right text-[11px] text-[#8C867C] shrink-0">
                  <p className="font-semibold text-[#555047]">{t.location_label || `Room ${t.room_number || '—'}`}</p>
                  <p>{t.assigned_to_name ? `→ ${t.assigned_to_name}` : 'Unassigned'}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {openedTicket && (
        <TicketDrawer ticket={openedTicket} onClose={() => setOpenedTicketUid(null)} />
      )}
    </div>
  );
};

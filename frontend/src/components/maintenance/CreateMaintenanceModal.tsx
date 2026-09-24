import React, { useRef, useState } from 'react';
import {
  Armchair, Building2, Camera, CheckCircle2, Droplets, Hammer,
  MoreHorizontal, Paintbrush, Plus, ShieldAlert, SprayCan, Ticket, Tv, Waves,
  Wifi, Wind, X, Zap,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { MaintenanceTicket, MaintenancePriority, Room, Dorm, Bed } from '../../types';
import * as mediaApi from '../../api/media';
import {
  MAINTENANCE_TYPE_OPTIONS,
  MAINTENANCE_STATUS_LABELS,
  PRIORITY_LABELS,
  MAINTENANCE_ISSUE_OPTIONS,
} from '../../lib/maintenanceUtils';

const TYPE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  electrical: Zap,
  plumbing: Droplets,
  civil: Building2,
  carpentry: Hammer,
  hvac: Wind,
  painting: Paintbrush,
  furniture: Armchair,
  appliance: Tv,
  internet: Wifi,
  water_drainage: Waves,
  cleaning_equipment: SprayCan,
  safety_security: ShieldAlert,
  other: MoreHorizontal,
};

const OTHER_ISSUE = '__other__';

/** One complaint = one ticket. The first uses the icon grid; extras are compact rows. */
interface Complaint {
  type: string;
  issueChoice: string;
  issue: string;
}
const emptyComplaint = (): Complaint => ({ type: '', issueChoice: '', issue: '' });

/** What the ticket is raised against — a room, a whole dorm, or a single bed. */
export type MaintenanceTarget =
  | { kind: 'room'; room: Room }
  | { kind: 'dorm'; dorm: Dorm }
  | { kind: 'bed'; dorm: Dorm; bed: Bed };

interface CreateMaintenanceModalProps {
  /** One or more units — bulk selections create a ticket per unit. */
  targets: MaintenanceTarget[] | null;
  /** Active (open/assigned/in_progress/on_hold) ticket — single-target only */
  activeTicket: MaintenanceTicket | null;
  onClose: () => void;
  onViewTicket: (ticket: MaintenanceTicket) => void;
}

export const CreateMaintenanceModal: React.FC<CreateMaintenanceModalProps> = ({
  targets,
  activeTicket,
  onClose,
  onViewTicket,
}) => {
  const { activeProperty, createMaintenanceBatch, addToast } = useApp();

  const [forceNew, setForceNew] = useState(false);
  const [createdTicket, setCreatedTicket] = useState<MaintenanceTicket | null>(null);
  const [createdBatches, setCreatedBatches] = useState<import('../../api/types').WorkBatch[]>([]);
  const [maintenanceType, setMaintenanceType] = useState('');
  const [issueChoice, setIssueChoice] = useState('');
  const [issue, setIssue] = useState('');
  const [extraComplaints, setExtraComplaints] = useState<Complaint[]>([]);
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<MaintenancePriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [photos, setPhotos] = useState<{ file: File; previewUrl: string }[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!targets || targets.length === 0) return null;

  const primary = targets[0];
  const isBulk = targets.length > 1;

  const labelFor = (t: MaintenanceTarget): string =>
    t.kind === 'room'
      ? `Room ${t.room.room_number}`
      : t.kind === 'bed'
        ? `${t.dorm.name} · ${t.bed.bed_number}`
        : t.dorm.name;

  // Context line shown under the title + used in the active-ticket guard
  const targetLabel = isBulk
    ? `${targets.length} units selected`
    : labelFor(primary);

  const issueOptions = maintenanceType ? MAINTENANCE_ISSUE_OPTIONS[maintenanceType] ?? [] : [];
  // Resolved issue text — preset choice, or free text for "Something else"
  const resolvedIssue =
    issueChoice && issueChoice !== OTHER_ISSUE ? issueChoice : issue.trim();

  // All complaints = the primary form fields + any extra rows
  const complaints: { type: string; issue: string }[] = [
    { type: maintenanceType, issue: resolvedIssue },
    ...extraComplaints.map((c) => ({
      type: c.type,
      issue: c.issueChoice && c.issueChoice !== OTHER_ISSUE ? c.issueChoice : c.issue.trim(),
    })),
  ];
  const complaintsValid = complaints.every((c) => c.type && c.issue);
  const totalTickets = targets.length * complaints.length;

  const updateComplaint = (i: number, patch: Partial<Complaint>) =>
    setExtraComplaints((prev) =>
      prev.map((c, j) => (j === i ? { ...c, ...patch } : c))
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complaintsValid || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const attachment_urls: string[] = [];
      for (const p of photos) {
        const res = await mediaApi.uploadPhoto(p.file);
        attachment_urls.push(res.url);
      }
      // One POST — the backend groups by zone and allocates each zone batch
      // to ONE employee via the persistent round-robin (never the frontend).
      const batches = await createMaintenanceBatch(
        targets.flatMap((t) =>
          complaints.map((c) => ({
            room_uid: t.kind === 'room' ? t.room.room_uid : undefined,
            dorm_uid: t.kind === 'dorm' ? t.dorm.dorm_uid : undefined,
            bed_uid: t.kind === 'bed' ? t.bed.bed_uid : undefined,
            maintenance_type: c.type,
            issue: c.issue,
            description: description.trim() || undefined,
            priority,
            due_date: dueDate || undefined,
            attachment_urls,
          }))
        )
      );
      const created = batches.flatMap((b) => b.tickets);
      const ticket = created[0];
      setCreatedTicket(ticket);
      setCreatedBatches(batches);
      addToast({
        type: 'success',
        title:
          created.length > 1
            ? `${created.length} Maintenance Tickets Created`
            : 'Maintenance Ticket Created',
        description:
          created.length > 1
            ? `${created.length} tickets created — units flagged for maintenance.`
            : `${ticket.ticket_number} — ${ticket.location_label || targetLabel} flagged for maintenance.`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Ticket Creation Failed',
        description: err instanceof Error ? err.message : 'Could not create the ticket.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ----------------------- success screen -----------------------
  if (createdTicket) {
    return (
      <Modal isOpen onClose={onClose} title="Maintenance Ticket Created" maxWidth="sm">
        <div className="text-center space-y-4 py-2">
          <div className="w-14 h-14 rounded-full bg-[#EBF3EC] text-[#386641] flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <div>
            <p className="font-mono font-bold text-xl text-[#24221F] tracking-tight">
              {createdTicket.ticket_number}
            </p>
            <p className="text-sm text-[#6C675F] mt-1">
              {MAINTENANCE_TYPE_OPTIONS.find((o) => o.value === createdTicket.maintenance_type)?.label || createdTicket.maintenance_type}
              {' · '}
              {PRIORITY_LABELS[createdTicket.priority]} priority
            </p>
            <p className="text-sm font-semibold text-[#24221F] mt-0.5">
              {createdTicket.location_label || targetLabel}
            </p>
            <p className="text-xs text-[#8C867C] mt-0.5">{createdTicket.issue}</p>
          </div>

          {/* Allocation result — backend round-robin decision */}
          {createdBatches.map((b) => (
            <div
              key={b.batch_id}
              className="w-full px-3.5 py-2.5 rounded-[10px] bg-[#F6F4EF] border border-[#EAE5DC] text-left"
            >
              <p className="text-[11px] font-semibold text-[#8C867C] uppercase tracking-wider">
                {b.batch_number}
                {b.zone_name ? ` · ${b.zone_name}` : ''}
              </p>
              {b.employee_name ? (
                <p className="text-sm font-semibold text-[#24221F] mt-1">
                  Assigned to {b.employee_name}
                  <span className="block text-[11px] font-normal text-[#6C675F] mt-0.5">
                    Automatic zone round-robin
                  </span>
                </p>
              ) : (
                <p className="text-sm font-semibold text-[#A32A2A] mt-1">
                  Unassigned — no eligible employee in this zone
                  <span className="block text-[11px] font-normal text-[#8C867C] mt-0.5">
                    A manager can assign it manually from Maintenance
                  </span>
                </p>
              )}
            </div>
          ))}

          <Badge variant="orange" size="md">
            Status: {MAINTENANCE_STATUS_LABELS[createdTicket.status]}
          </Badge>
          <Button
            variant="primary"
            className="w-full"
            onClick={() => onViewTicket(createdTicket)}
          >
            <Ticket className="w-4 h-4 mr-1.5" />
            {isBulk ? 'View Tickets' : 'View Ticket'}
          </Button>
        </div>
      </Modal>
    );
  }

  // --------------- active ticket exists — offer it first (single unit only) ---------------
  if (activeTicket && !forceNew && !isBulk) {
    return (
      <Modal isOpen onClose={onClose} title="Active Maintenance" maxWidth="sm">
        <div className="space-y-4">
          <div className="p-4 rounded-[12px] bg-[#FDF6EC] border border-[#EFDDBE]">
            <p className="font-mono font-bold text-sm text-[#24221F]">
              {activeTicket.ticket_number}
            </p>
            <p className="text-xs text-[#6C675F] mt-1">
              {MAINTENANCE_TYPE_OPTIONS.find((o) => o.value === activeTicket.maintenance_type)?.label || activeTicket.maintenance_type}
              {' · '}
              {PRIORITY_LABELS[activeTicket.priority]} ·{' '}
              {MAINTENANCE_STATUS_LABELS[activeTicket.status]}
            </p>
            <p className="text-sm text-[#24221F] mt-1.5">{activeTicket.issue}</p>
          </div>
          <p className="text-xs text-[#8C867C]">
            {targetLabel} already has an active maintenance ticket. Open
            it to track progress, or report a separate issue.
          </p>
          <div className="flex gap-2.5">
            <Button variant="outline" className="flex-1" onClick={() => setForceNew(true)}>
              New Ticket
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => onViewTicket(activeTicket)}
            >
              View Active Ticket
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // --------------------------- create form ---------------------------
  const sectionLabel = 'block text-[11px] font-semibold text-[#8C867C] uppercase tracking-[0.08em] mb-2';
  const fieldLabel = 'block text-[13px] font-medium text-[#45413B] mb-1.5';
  const inputCls =
    'w-full h-[42px] px-3.5 bg-white border border-[#E2DCD0] rounded-[10px] ' +
    'text-sm text-[#24221F] placeholder:text-[13px] placeholder:text-[#A39D92] ' +
    'focus:outline-none focus:ring-[3px] focus:ring-[#386641]/15 focus:border-[#386641] ' +
    'transition-[border-color,box-shadow] duration-150';
  const PRIORITY_DOT: Record<MaintenancePriority, string> = {
    low: '#6BAA75',
    medium: '#D9A441',
    high: '#D05B4B',
    critical: '#B3372C',
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Create Maintenance Ticket"
      description={`${targetLabel} · ${activeProperty?.name}`}
      maxWidth="lg"
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
            className="h-[42px] px-5 rounded-[10px]"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="maintenance-ticket-form"
            variant="primary"
            isLoading={isSubmitting}
            disabled={!complaintsValid}
            className="h-[42px] px-6 rounded-[10px] font-semibold"
          >
            {totalTickets > 1 ? `Create ${totalTickets} Tickets` : 'Create Ticket'}
          </Button>
        </div>
      }
    >
      <form id="maintenance-ticket-form" onSubmit={handleSubmit} className="space-y-5 pb-1">
        {/* Bulk selection — show every unit receiving a ticket */}
        {isBulk && (
          <div className="flex flex-wrap gap-1.5 -mt-1">
            {targets.map((t, i) => (
              <span
                key={i}
                className="px-2 py-1 rounded-[7px] bg-[#F2EEE7] border border-[#E4DFD5] text-[11px] font-medium text-[#555047]"
              >
                {labelFor(t)}
              </span>
            ))}
          </div>
        )}

        {/* 1 — Category */}
        <section>
          <p className={sectionLabel}>1 · Category</p>
          <div
            role="radiogroup"
            aria-label="Maintenance type"
            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5"
          >
            {MAINTENANCE_TYPE_OPTIONS.map((o) => {
              const Icon = TYPE_ICONS[o.value] || MoreHorizontal;
              const selected = maintenanceType === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setMaintenanceType(o.value);
                    setIssueChoice('');
                    setIssue('');
                  }}
                  className={`flex items-center gap-2.5 h-[54px] px-3 rounded-[11px] border text-left transition-colors duration-150 cursor-pointer ${
                    selected
                      ? 'border-[#386641] bg-[#EDF4EE]'
                      : 'border-[#E2DCD0] bg-white hover:border-[#C5BFB2] hover:bg-[#FAF8F4]'
                  }`}
                >
                  <span
                    className={`w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 transition-colors duration-150 ${
                      selected ? 'bg-[#386641] text-white' : 'bg-[#F2EEE7] text-[#736E65]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </span>
                  <span
                    className={`text-[13px] font-medium leading-tight ${
                      selected ? 'text-[#244E2C]' : 'text-[#45413B]'
                    }`}
                  >
                    {o.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 2 — Problem */}
        <section>
          <p className={sectionLabel}>2 · Problem</p>
          <label className={fieldLabel} htmlFor="mt-issue">
            Issue / Problem <span className="text-[#B3372C]">*</span>
          </label>
          <select
            id="mt-issue"
            value={issueChoice}
            onChange={(e) => {
              setIssueChoice(e.target.value);
              if (e.target.value !== OTHER_ISSUE) setIssue('');
            }}
            disabled={!maintenanceType}
            className={`${inputCls} cursor-pointer disabled:bg-[#F7F5F0] disabled:text-[#A39D92] disabled:cursor-not-allowed`}
          >
            <option value="">
              {maintenanceType ? 'Select issue…' : 'Choose a category first'}
            </option>
            {issueOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
            <option value={OTHER_ISSUE}>Something else…</option>
          </select>
          {(issueChoice === OTHER_ISSUE || (maintenanceType && issueOptions.length === 0)) && (
            <input
              type="text"
              required
              value={issue}
              onChange={(e) => setIssue(e.target.value)}
              placeholder="Describe the issue — e.g. Bathroom tap leaking"
              className={`${inputCls} mt-2`}
            />
          )}

          {/* Additional complaints — each becomes its own ticket */}
          {extraComplaints.map((c, i) => {
            const opts = c.type ? MAINTENANCE_ISSUE_OPTIONS[c.type] ?? [] : [];
            return (
              <div
                key={i}
                className="mt-3 p-3 rounded-[11px] border border-[#EBE6DC] bg-[#FAF8F4] space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#8C867C] uppercase tracking-wider">
                    Complaint {i + 2}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove complaint ${i + 2}`}
                    onClick={() =>
                      setExtraComplaints((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="w-6 h-6 rounded-[7px] flex items-center justify-center text-[#8C867C] hover:text-[#B3372C] hover:bg-[#F7EDEB] transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <select
                    value={c.type}
                    onChange={(e) =>
                      updateComplaint(i, { type: e.target.value, issueChoice: '', issue: '' })
                    }
                    className={`${inputCls} cursor-pointer`}
                    aria-label={`Complaint ${i + 2} category`}
                  >
                    <option value="">Category…</option>
                    {MAINTENANCE_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <select
                    value={c.issueChoice}
                    onChange={(e) =>
                      updateComplaint(i, {
                        issueChoice: e.target.value,
                        issue: e.target.value !== OTHER_ISSUE ? '' : c.issue,
                      })
                    }
                    disabled={!c.type}
                    className={`${inputCls} cursor-pointer disabled:bg-[#F2EFE9] disabled:text-[#A39D92]`}
                    aria-label={`Complaint ${i + 2} issue`}
                  >
                    <option value="">{c.type ? 'Select issue…' : 'Pick a category first'}</option>
                    {opts.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                    <option value={OTHER_ISSUE}>Something else…</option>
                  </select>
                </div>
                {(c.issueChoice === OTHER_ISSUE || (c.type && opts.length === 0)) && (
                  <input
                    type="text"
                    value={c.issue}
                    onChange={(e) => updateComplaint(i, { issue: e.target.value })}
                    placeholder="Describe the issue"
                    className={inputCls}
                  />
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => setExtraComplaints((prev) => [...prev, emptyComplaint()])}
            className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#386641] hover:text-[#2F5637] transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add another complaint
          </button>
        </section>

        {/* 3 — Details */}
        <section>
          <p className={sectionLabel}>3 · Details</p>
          <label className={fieldLabel} htmlFor="mt-desc">
            Description <span className="text-[#A39D92] font-normal">(optional)</span>
          </label>
          <textarea
            id="mt-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Location in the room, symptoms, when it started, how often it occurs…"
            className="w-full min-h-[96px] px-3.5 py-2.5 bg-white border border-[#E2DCD0] rounded-[10px] text-sm leading-relaxed text-[#24221F] placeholder:text-[13px] placeholder:text-[#A39D92] focus:outline-none focus:ring-[3px] focus:ring-[#386641]/15 focus:border-[#386641] resize-y transition-[border-color,box-shadow] duration-150"
          />
        </section>

        {/* 4 — Scheduling */}
        <section>
          <p className={sectionLabel}>4 · Scheduling</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className={fieldLabel} htmlFor="mt-priority">
                Priority <span className="text-[#B3372C]">*</span>
              </label>
              <div className="relative">
                <span
                  aria-hidden
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full pointer-events-none"
                  style={{ backgroundColor: PRIORITY_DOT[priority] }}
                />
                <select
                  id="mt-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as MaintenancePriority)}
                  className={`${inputCls} pl-8 cursor-pointer`}
                >
                  {(['low', 'medium', 'high', 'critical'] as const).map((p) => (
                    <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={fieldLabel} htmlFor="mt-due">
                Preferred Resolution Date
              </label>
              <input
                id="mt-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
        </section>

        {/* 5 — Evidence */}
        <section>
          <p className={sectionLabel}>5 · Evidence</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              setPhotos((prev) => [
                ...prev,
                ...files.map((f) => ({ file: f, previewUrl: URL.createObjectURL(f) })),
              ]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-[11px] border border-dashed border-[#CFC8BA] bg-[#FAF8F4] text-left hover:border-[#386641]/60 hover:bg-[#F4F1EA] transition-colors duration-150 cursor-pointer"
          >
            <span className="w-9 h-9 rounded-[9px] bg-white border border-[#E8E3D9] flex items-center justify-center shrink-0 text-[#736E65]">
              <Camera className="w-4 h-4" />
            </span>
            <span>
              <span className="block text-[13px] font-medium text-[#45413B]">
                {photos.length > 0 ? 'Add another photo' : 'Upload photo'}
              </span>
              <span className="block text-xs text-[#8C867C] mt-0.5">
                Optional — helps the technician locate the issue
              </span>
            </span>
          </button>
          {photos.length > 0 && (
            <div className="mt-2.5 space-y-1.5">
              {photos.map((p, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3 py-2 rounded-[10px] border border-[#EBE6DC] bg-white"
                >
                  <img
                    src={p.previewUrl}
                    alt={p.file.name}
                    className="w-10 h-10 rounded-[7px] object-cover border border-[#EDE8DE] shrink-0"
                  />
                  <span className="flex-1 text-[13px] text-[#45413B] truncate">
                    {p.file.name}
                  </span>
                  <span className="text-[11px] text-[#A39D92] shrink-0">
                    {Math.max(1, Math.round(p.file.size / 1024))} KB
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${p.file.name}`}
                    onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                    className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[#8C867C] hover:text-[#B3372C] hover:bg-[#F7EDEB] transition-colors cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </form>
    </Modal>
  );
};

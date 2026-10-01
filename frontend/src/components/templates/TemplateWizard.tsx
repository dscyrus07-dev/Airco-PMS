import React, { useMemo, useState } from 'react';
import {
  Check, ChevronLeft, ChevronRight, Plus, X, GripVertical, Trash2,
  ClipboardList, Users, MapPin, CalendarClock, ListChecks, ShieldCheck, Eye,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import * as templatesApi from '../../api/templates';
import {
  WorkTemplate, WorkTemplateCreateRequest, TemplateChecklistItem, TemplateLocation,
} from '../../api/types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { isEmployeeAssignable } from '../../lib/employeeUtils';

const STEPS = [
  { key: 'basics', label: 'Basics', icon: ClipboardList, q: 'What needs to be done?' },
  { key: 'assign', label: 'Assignment', icon: Users, q: 'Who should do it?' },
  { key: 'location', label: 'Condition', icon: MapPin, q: 'Which resources should this apply to?' },
  { key: 'schedule', label: 'Schedule', icon: CalendarClock, q: 'When should it happen?' },
  { key: 'instructions', label: 'Instructions', icon: ListChecks, q: 'How should it be done?' },
  { key: 'verify', label: 'Verify', icon: ShieldCheck, q: 'How is completion verified?' },
  { key: 'review', label: 'Review', icon: Eye, q: 'Everything look right?' },
];

// Work Type — the domain kind of the generated work items. It decides the
// ticket/task kind, the default category and department eligibility for
// zone allocation (cleaning/housekeeping → housekeeping staff only,
// maintenance → maintenance/engineering).
const WORK_TYPES: { v: WorkTemplate['template_type']; l: string; hint: string }[] = [
  { v: 'cleaning', l: 'Cleaning', hint: 'Housekeeping staff only' },
  { v: 'maintenance', l: 'Maintenance', hint: 'Maintenance / engineering staff' },
  { v: 'inspection', l: 'Inspection', hint: 'Any eligible staff' },
  { v: 'housekeeping', l: 'Housekeeping', hint: 'Housekeeping staff only' },
  { v: 'other', l: 'Other', hint: 'Any eligible staff' },
];
// Templates saved before the Work Type model keep their legacy type —
// render it as an extra selected chip instead of silently rewriting it.
const LEGACY_TYPE_LABELS: Record<string, string> = {
  task: 'Task', operations: 'Operations', checklist: 'Checklist',
};
const WORK_TYPE_CATEGORY: Record<string, string> = {
  cleaning: 'housekeeping', housekeeping: 'housekeeping',
  maintenance: 'maintenance', inspection: 'inspection', other: 'other',
};
const CATEGORIES = ['housekeeping', 'maintenance', 'operations', 'safety', 'inspection', 'guest_services', 'inventory', 'security', 'other'];
const TEAMS = ['Housekeeping', 'Maintenance', 'Front Desk', 'Security', 'Operations'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const OVERDUE_ACTIONS = [
  { v: 'mark_overdue', l: 'Mark as Overdue' },
  { v: 'notify_supervisor', l: 'Notify Supervisor' },
  { v: 'notify_manager', l: 'Notify Property Manager' },
  { v: 'auto_reassign', l: 'Automatically Reassign' },
];

const inputCls =
  'w-full px-3 py-2.5 text-sm bg-white border border-[#E2DCD0] rounded-[10px] placeholder:text-[#B5AEA2] focus:outline-none focus:ring-[3px] focus:ring-[#386641]/15 focus:border-[#386641] transition-all';
const labelCls = 'block text-[11px] font-semibold text-[#8C867C] uppercase tracking-wider mb-1.5';

function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void;
  options: { v: T; l: string; hint?: string }[];
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 3)}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={o.v} type="button" onClick={() => onChange(o.v)}
          className={`px-3 py-2.5 rounded-[10px] border text-left transition-all cursor-pointer ${
            value === o.v
              ? 'bg-[#EBF3EC] border-[#386641] text-[#244E2C]'
              : 'bg-white border-[#E2DCD0] text-[#58534C] hover:border-[#C8C1B4]'
          }`}
        >
          <span className="block text-[13px] font-semibold">{o.l}</span>
          {o.hint && <span className="block text-[11px] text-[#8C867C] mt-0.5">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

interface Props {
  editTemplate?: WorkTemplate | null;
  onClose: () => void;
  onSaved: (t: WorkTemplate) => void;
}

// "All areas" + "All zones" IS property scope — a uid-scope left without
// its uid means "everywhere", so widen it instead of blocking the wizard.
const normalizeLocation = (l?: TemplateLocation | null): TemplateLocation => {
  const loc: TemplateLocation = l ? { ...l } : { scope: 'property', target: 'rooms' };
  if (loc.scope === 'zone' && !loc.zone_uid) loc.scope = loc.area_uid ? 'area' : 'property';
  if (loc.scope === 'area' && !loc.area_uid) loc.scope = 'property';
  return loc;
};

export const TemplateWizard: React.FC<Props> = ({ editTemplate, onClose, onSaved }) => {
  const {
    activePropertyUid, activeProperty, currentPropertyEmployees,
    currentPropertyZones, currentPropertyAreas, currentPropertyRooms,
    currentPropertyDorms, currentPropertyWashrooms, addToast,
  } = useApp();

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const [form, setForm] = useState<WorkTemplateCreateRequest>(() => ({
    property_uid: activePropertyUid,
    name: editTemplate?.name || '',
    template_type: editTemplate?.template_type || 'cleaning',
    description: editTemplate?.description || '',
    category: editTemplate?.category || 'housekeeping',
    priority: editTemplate?.priority || 'medium',
    duration_minutes: editTemplate?.duration_minutes,
    status: 'draft',
    assignment: editTemplate?.assignment || { mode: 'automatic', method: 'zone_round_robin' },
    location: normalizeLocation(editTemplate?.location),
    schedule: editTemplate?.schedule || { kind: 'recurring', frequency: 'daily', time: '10:00', timezone: 'Asia/Kolkata' },
    checklist: editTemplate?.checklist || [],
    verification: editTemplate?.verification || { checklist_required: true },
    overdue: editTemplate?.overdue || { actions: ['mark_overdue'], threshold_minutes: 30 },
    notifications: editTemplate?.notifications || { notify_on_assignment: true, notify_on_overdue: true },
  }));

  const [roomSearch, setRoomSearch] = useState('');
  const [newItem, setNewItem] = useState('');

  const set = (patch: Partial<WorkTemplateCreateRequest>) =>
    setForm((f) => ({ ...f, ...patch }));
  const setSub = <K extends 'assignment' | 'location' | 'schedule' | 'verification' | 'overdue' | 'notifications'>(
    key: K, patch: object
  ) => setForm((f) => ({ ...f, [key]: { ...(f[key] as object), ...patch } }));

  const loc = form.location!;
  const sched = form.schedule!;
  const assign = form.assignment!;

  const zoneRooms = useMemo(
    () => currentPropertyRooms.filter((r) => !loc.zone_uid || r.zone_uid === loc.zone_uid),
    [currentPropertyRooms, loc.zone_uid]
  );
  const filteredRooms = useMemo(
    () => zoneRooms.filter((r) => !roomSearch || r.room_number.toLowerCase().includes(roomSearch.toLowerCase())),
    [zoneRooms, roomSearch]
  );
  const selectedRooms = loc.room_uids || [];

  const toggleRoom = (uid: string) => {
    const next = selectedRooms.includes(uid)
      ? selectedRooms.filter((x) => x !== uid)
      : [...selectedRooms, uid];
    setSub('location', { room_uids: next });
  };

  // ---- Condition (resource × occupancy × scope) -------------------------
  // Derived FROM loc — the stored location config is the condition model:
  //   resource → target, scope → scope (specific = the uid-picker scopes),
  //   occupancy → occupancy. Resolved server-side at generation time.
  type CondResource = 'rooms' | 'beds' | 'dorms' | 'washrooms' | 'rooms_beds';
  type CondScope = 'property' | 'area' | 'zone' | 'specific';
  const SPECIFIC_KINDS = ['rooms', 'dorms', 'beds', 'washrooms', 'units'];
  const isSpecific = SPECIFIC_KINDS.includes(loc.scope as string);
  const condResource: CondResource = isSpecific
    ? loc.scope === 'dorms' && loc.target === 'beds'
      ? 'beds'
      : loc.scope === 'units'
        ? 'rooms_beds'
        : (loc.scope as CondResource)
    : loc.target === 'units' || !loc.target
      ? 'rooms'
      : (loc.target as CondResource);
  const condScope: CondScope = isSpecific ? 'specific' : (loc.scope as CondScope);
  const condOccupancy: 'all' | 'occupied' | 'unoccupied' =
    loc.occupancy === 'occupied' || loc.occupied_only
      ? 'occupied'
      : loc.occupancy === 'unoccupied'
        ? 'unoccupied'
        : 'all';

  const setCondition = (patch: {
    resource?: CondResource;
    scope?: CondScope;
    occupancy?: 'all' | 'occupied' | 'unoccupied';
  }) => {
    const resource = patch.resource ?? condResource;
    const scope = patch.scope ?? condScope;
    const occupancy = patch.occupancy ?? condOccupancy;
    const next: NonNullable<WorkTemplateCreateRequest['location']> = { ...loc };
    if (scope === 'specific') {
      // dorm beds narrow to a specific dorm; 'all units' picks rooms + beds
      next.scope =
        resource === 'beds' ? 'dorms'
          : resource === 'rooms_beds' ? 'units'
            : resource;
      next.target = resource === 'beds' ? 'beds' : undefined;
    } else {
      next.scope = scope;
      next.target = resource;
    }
    next.occupancy =
      resource === 'washrooms' || occupancy === 'all' ? undefined : occupancy;
    next.occupied_only = undefined;
    set({ location: next });
  };

  const zoneChoices = useMemo(
    () =>
      currentPropertyZones.filter(
        (z) => !loc.area_uid || z.area_uid === loc.area_uid
      ),
    [currentPropertyZones, loc.area_uid]
  );
  const areaName = (uid?: string | null) =>
    currentPropertyAreas.find((a) => a.area_uid === uid)?.name;

  // Area/Zone selects ARE the scope — picking a zone makes scope 'zone',
  // area alone → 'area', neither → 'property'. A zone can never stay
  // selected under an area it doesn't belong to.
  const applyScopePick = (patch: { area_uid?: string; zone_uid?: string }) => {
    const area_uid = patch.area_uid !== undefined ? patch.area_uid : loc.area_uid;
    let zone_uid = patch.zone_uid !== undefined ? patch.zone_uid : loc.zone_uid;
    if (area_uid && zone_uid) {
      const z = currentPropertyZones.find((x) => x.zone_uid === zone_uid);
      if (z && z.area_uid && z.area_uid !== area_uid) zone_uid = undefined;
    }
    set({
      location: {
        ...loc,
        scope: zone_uid ? 'zone' : area_uid ? 'area' : 'property',
        target: condResource,
        area_uid: area_uid || undefined,
        zone_uid: zone_uid || undefined,
        occupancy:
          condResource === 'washrooms' || condOccupancy === 'all'
            ? undefined
            : condOccupancy,
        occupied_only: undefined,
      },
    });
  };

  const conditionSummary = (): string => {
    const occ =
      condOccupancy === 'occupied'
        ? 'currently occupied'
        : condOccupancy === 'unoccupied'
          ? 'currently unoccupied'
          : 'all';
    const res = {
      rooms: 'rooms',
      beds: 'dorm beds',
      dorms: 'dorms',
      washrooms: 'washrooms',
      rooms_beds: 'units (rooms + dorm beds)',
    }[condResource];
    const where =
      condScope === 'zone'
        ? `in ${currentPropertyZones.find((z) => z.zone_uid === loc.zone_uid)?.name || 'the selected zone'}`
        : condScope === 'area'
          ? `in ${areaName(loc.area_uid) || 'the selected area'}`
          : condScope === 'specific'
            ? 'on the selected units only'
            : 'in this property';
    return `Applies to ${occ} ${res} ${where} — resolved against live occupancy when the task is generated.`;
  };

  // ---- per-step validation ----
  const stepError = (): string | null => {
    switch (STEPS[step].key) {
      case 'basics':
        if (form.name.trim().length < 3) return 'Give the template a name (3+ characters).';
        return null;
      case 'assign':
        if (assign.mode === 'individual' && !assign.employee_uid) return 'Pick an employee.';
        if (assign.mode === 'employees' && !(assign.employee_uids || []).length)
          return 'Pick at least one employee.';
        if (assign.mode === 'team' && !assign.team) return 'Pick a team.';
        if (assign.mode === 'department' && !assign.department) return 'Pick a department.';
        return null;
      case 'location':
        if (form.template_type === 'operations') return null;
        if (loc.scope === 'zone' && !loc.zone_uid) return 'Pick a zone.';
        if (loc.scope === 'area' && !loc.area_uid) return 'Pick an area.';
        if (loc.scope === 'rooms' && !selectedRooms.length) return 'Select at least one room.';
        if (loc.scope === 'dorms' && loc.target === 'beds' && !(loc.dorm_uids || []).length)
          return 'Select at least one dorm.';
        if (loc.scope === 'dorms' && !(loc.dorm_uids || []).length) return 'Select at least one dorm.';
        if (loc.scope === 'beds' && !(loc.bed_uids || []).length) return 'Select at least one bed.';
        if (loc.scope === 'units' && !(loc.room_uids || []).length && !(loc.bed_uids || []).length)
          return 'Select at least one unit.';
        if (loc.scope === 'washrooms' && !(loc.washroom_uids || []).length) return 'Select at least one washroom.';
        return null;
      case 'schedule':
        if (sched.kind === 'one_time' && !sched.date) return 'Pick a date.';
        if (sched.kind === 'recurring') {
          if (!sched.frequency) return 'Pick a frequency.';
          if (sched.frequency === 'weekly' && !(sched.weekdays || []).length)
            return 'Pick at least one weekday.';
          if (sched.frequency === 'monthly' && !sched.day_of_month && !sched.relative_week)
            return 'Pick a day of month or a relative day.';
        }
        return null;
      default:
        return null;
    }
  };

  const next = () => {
    const err = stepError();
    if (err) { addToast({ type: 'warning', title: err }); return; }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const save = async (status: 'draft' | 'active') => {
    setSubmitting(true);
    try {
      const payload = { ...form, status, name: form.name.trim() };
      // Operations has no physical target — force a property-level
      // condition so the task is never tied to a fake room/zone.
      if (payload.template_type === 'operations') {
        payload.location = { scope: 'property' };
      }
      payload.location = normalizeLocation(payload.location);
      const t = editTemplate
        ? await templatesApi.updateTemplate(editTemplate.template_uid, payload)
        : await templatesApi.createTemplate(payload);
      if (status === 'active' && t.status === 'draft') {
        await templatesApi.templateAction(t.template_uid, 'activate');
      }
      addToast({
        type: 'success',
        title: editTemplate ? 'Template updated' : status === 'active' ? 'Template activated' : 'Draft saved',
        description: t.name,
      });
      onSaved(t);
    } catch (err) {
      addToast({ type: 'error', title: 'Could not save template', description: err instanceof Error ? err.message : '' });
    } finally {
      setSubmitting(false);
    }
  };

  const addChecklistItem = () => {
    const title = newItem.trim();
    if (!title) return;
    set({ checklist: [...(form.checklist || []), { title, required: true } as TemplateChecklistItem] });
    setNewItem('');
  };

  const moveItem = (from: number, to: number) => {
    const items = [...(form.checklist || [])];
    const [it] = items.splice(from, 1);
    items.splice(to, 0, it);
    set({ checklist: items });
  };

  const tzLabel = 'IST';

  return (
    <Modal isOpen onClose={onClose} title={editTemplate ? 'Edit Work Template' : 'Create Work Template'} maxWidth="xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          <div className="flex items-center gap-2">
            {step === STEPS.length - 1 ? (
              <>
                <Button variant="outline" onClick={() => void save('draft')} disabled={submitting}>
                  Save as Draft
                </Button>
                <Button variant="primary" onClick={() => void save('active')} disabled={submitting}>
                  {editTemplate ? 'Save & Activate' : 'Create Template'}
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={next}>
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      }
    >
      {/* Stepper */}
      <div className="flex items-center gap-1 mb-5 overflow-x-auto pb-1">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const done = i < step;
          const current = i === step;
          return (
            <React.Fragment key={s.key}>
              {i > 0 && <div className={`flex-1 h-px min-w-[8px] ${done ? 'bg-[#386641]' : 'bg-[#E2DCD0]'}`} />}
              <button
                type="button" onClick={() => i < step && setStep(i)}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-[8px] text-[11px] font-semibold whitespace-nowrap transition-colors ${
                  current ? 'bg-[#EBF3EC] text-[#244E2C]' : done ? 'text-[#386641] cursor-pointer hover:bg-[#F5F2EB]' : 'text-[#A59F95]'
                }`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                  done ? 'bg-[#386641] text-white' : current ? 'bg-[#244E2C] text-white' : 'bg-[#E2DCD0] text-[#8C867C]'
                }`}>
                  {done ? <Check className="w-3 h-3" /> : i + 1}
                </span>
                {s.label}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      <p className="text-[15px] font-semibold text-[#24221F] mb-4">{STEPS[step].q}</p>

      {/* ======================== STEP 1 — BASICS ======================== */}
      {step === 0 && (
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Work Type *</label>
            <div className="flex flex-wrap gap-2">
              {[
                ...WORK_TYPES,
                ...(WORK_TYPES.some((t) => t.v === form.template_type)
                  ? []
                  : [{
                      v: form.template_type,
                      l: LEGACY_TYPE_LABELS[form.template_type] || form.template_type,
                      hint: 'Legacy type',
                    }]),
              ].map((t) => (
                <button key={t.v} type="button"
                  onClick={() => {
                    // Keep category in step with the work kind while it still
                    // holds the previous kind's default — never clobber a
                    // category the user deliberately picked.
                    const prevDefault = WORK_TYPE_CATEGORY[form.template_type];
                    const patch: Partial<WorkTemplateCreateRequest> = { template_type: t.v };
                    if (!form.category || form.category === prevDefault)
                      patch.category = WORK_TYPE_CATEGORY[t.v] || 'other';
                    set(patch);
                  }}
                  className={`px-3.5 py-2 rounded-[10px] border text-left cursor-pointer transition-all ${
                    form.template_type === t.v
                      ? 'bg-[#EBF3EC] border-[#386641] text-[#244E2C]'
                      : 'bg-white border-[#E2DCD0] text-[#58534C] hover:border-[#C8C1B4]'
                  }`}>
                  <span className="block text-[13px] font-medium">{t.l}</span>
                  <span className={`block text-[10.5px] mt-0.5 ${
                    form.template_type === t.v ? 'text-[#386641]' : 'text-[#A59F95]'
                  }`}>{t.hint}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[#8C867C] mt-1.5">
              Sets the kind of work and which employees are eligible. On each
              scheduled run the system creates an individual work item per
              matching room, dorm bed or unit — then allocates them zone by zone.
            </p>
          </div>
          <div>
            <label className={labelCls}>Template Name *</label>
            <input value={form.name} onChange={(e) => set({ name: e.target.value })}
              placeholder="e.g. Daily Room Inspection" className={inputCls} autoFocus />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <textarea rows={3} value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="What should be checked or done…" className={`${inputCls} resize-y`} />
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className={labelCls}>Category</label>
              <select value={form.category} onChange={(e) => set({ category: e.target.value })}
                className={`${inputCls} cursor-pointer`}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Priority</label>
              <select value={form.priority}
                onChange={(e) => set({ priority: e.target.value as WorkTemplate['priority'] })}
                className={`${inputCls} cursor-pointer`}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ======================== STEP 2 — ASSIGNMENT ======================== */}
      {step === 1 && (
        <div className="space-y-4">
          <Segmented
            value={assign.mode}
            onChange={(mode) => setSub('assignment', { mode })}
            options={[
              { v: 'automatic' as const, l: 'Automatic', hint: 'System decides by location' },
              { v: 'individual' as const, l: 'Individual', hint: 'One named employee' },
              { v: 'employees' as const, l: 'Employees', hint: 'Fair rotation across named people' },
              { v: 'team' as const, l: 'Team', hint: 'A whole team picks it up' },
              { v: 'department' as const, l: 'Department', hint: 'Fair rotation inside a department' },
            ]}
          />

          {assign.mode === 'team' && (
            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className={labelCls}>Select Team *</label>
                <select value={assign.team || ''} onChange={(e) => setSub('assignment', { team: e.target.value })}
                  className={`${inputCls} cursor-pointer`}>
                  <option value="">Choose…</option>
                  {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Team Supervisor</label>
                <select value={assign.supervisor_uid || ''}
                  onChange={(e) => setSub('assignment', { supervisor_uid: e.target.value || undefined })}
                  className={`${inputCls} cursor-pointer`}>
                  <option value="">None</option>
                  {currentPropertyEmployees.filter(isEmployeeAssignable).map((e) => (
                    <option key={e.employee_uid} value={e.employee_uid}>{e.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {assign.mode === 'individual' && (
            <div>
              <label className={labelCls}>Select Employee *</label>
              <select value={assign.employee_uid || ''}
                onChange={(e) => setSub('assignment', { employee_uid: e.target.value || undefined })}
                className={`${inputCls} cursor-pointer`}>
                <option value="">Choose…</option>
                {currentPropertyEmployees.filter(isEmployeeAssignable).map((e) => (
                  <option key={e.employee_uid} value={e.employee_uid}>
                    {e.name} — {e.job_title || e.department || 'Staff'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {assign.mode === 'employees' && (
            <div>
              <label className={labelCls}>Select Employees *</label>
              <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto">
                {currentPropertyEmployees.filter(isEmployeeAssignable).map((e) => {
                  const picked = (assign.employee_uids || []).includes(e.employee_uid);
                  return (
                    <button key={e.employee_uid} type="button"
                      onClick={() => {
                        const cur = new Set(assign.employee_uids || []);
                        if (picked) cur.delete(e.employee_uid); else cur.add(e.employee_uid);
                        setSub('assignment', { employee_uids: [...cur] });
                      }}
                      className={`px-2.5 py-2 rounded-[9px] border text-left cursor-pointer transition-all text-[12px] font-medium ${
                        picked
                          ? 'bg-[#EBF3EC] border-[#386641] text-[#244E2C]'
                          : 'bg-white border-[#E2DCD0] text-[#58534C] hover:border-[#C8C1B4]'
                      }`}>
                      {e.name}
                      <span className="block text-[10.5px] font-normal text-[#8C867C]">
                        {e.job_title || e.department || 'Staff'}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-[#8C867C] mt-1.5">
                The allocator rotates fairly across the selected people — nobody is first in line.
              </p>
            </div>
          )}

          {assign.mode === 'department' && (
            <div>
              <label className={labelCls}>Select Department *</label>
              <select value={assign.department || ''}
                onChange={(e) => setSub('assignment', { department: e.target.value || undefined })}
                className={`${inputCls} cursor-pointer`}>
                <option value="">Choose…</option>
                {TEAMS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <p className="text-[11px] text-[#8C867C] mt-1.5">
                All active employees in this department form the pool; work is
                distributed fairly by workload.
              </p>
            </div>
          )}

          {assign.mode === 'automatic' && (
            <div>
              <label className={labelCls}>Allocation Method</label>
              <Segmented
                value={(assign.method || 'zone_round_robin') as 'zone_round_robin' | 'team_round_robin' | 'supervisor'}
                onChange={(method) => setSub('assignment', { method })}
                options={[
                  { v: 'zone_round_robin' as const, l: 'Zone Round Robin', hint: 'Fair rotation inside the zone' },
                  { v: 'team_round_robin' as const, l: 'Team Round Robin', hint: 'Rotate within a team' },
                  { v: 'supervisor' as const, l: 'Supervisor Assignment', hint: 'Supervisor assigns' },
                ]}
              />
              <p className="text-[11px] text-[#8C867C] mt-2">
                Uses the shared Work Allocation Engine — the actual employee is chosen when work is generated.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ======================== STEP 3 — CONDITION ======================== */}
      {step === 2 && form.template_type === 'operations' && (
        <div className="rounded-[12px] border border-[#E2DCD0] bg-[#FBFAF7] px-4 py-3.5">
          <div className="text-[12.5px] font-semibold text-[#3C3832]">No physical target</div>
          <p className="text-[12px] text-[#8C867C] mt-1 leading-relaxed">
            Operations tasks apply to the property as a whole — no rooms, zones,
            or occupancy conditions. Who receives the work is decided by the
            assignment mode on the previous step (people, team, or department),
            and the allocator distributes it fairly.
          </p>
        </div>
      )}
      {step === 2 && form.template_type !== 'operations' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Resource</label>
              <select
                value={condResource}
                onChange={(e) =>
                  setCondition({ resource: e.target.value as typeof condResource })
                }
                className={`${inputCls} cursor-pointer`}
              >
                <option value="rooms">Rooms</option>
                <option value="beds">Dorm beds</option>
                <option value="dorms">Dorms</option>
                <option value="washrooms">Washrooms</option>
                <option value="rooms_beds">All units</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Occupancy</label>
              <select
                value={condOccupancy}
                disabled={condResource === 'washrooms'}
                onChange={(e) =>
                  setCondition({
                    occupancy: e.target.value as 'all' | 'occupied' | 'unoccupied',
                  })
                }
                className={`${inputCls} cursor-pointer disabled:opacity-50`}
              >
                <option value="all">All</option>
                <option value="occupied">Occupied</option>
                <option value="unoccupied">Unoccupied</option>
              </select>
            </div>
          </div>

          {condScope !== 'specific' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Area</label>
                <select
                  value={loc.area_uid || ''}
                  onChange={(e) =>
                    applyScopePick({ area_uid: e.target.value || undefined })
                  }
                  className={`${inputCls} cursor-pointer`}
                >
                  <option value="">All areas</option>
                  {currentPropertyAreas.map((a) => (
                    <option key={a.area_uid} value={a.area_uid}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Zone</label>
                <select
                  value={loc.zone_uid || ''}
                  onChange={(e) =>
                    applyScopePick({ zone_uid: e.target.value || undefined })
                  }
                  className={`${inputCls} cursor-pointer`}
                >
                  <option value="">All zones</option>
                  {zoneChoices.map((z) => (
                    <option key={z.zone_uid} value={z.zone_uid}>
                      {z.name}{z.area_uid ? ` — ${areaName(z.area_uid) || ''}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-[13px] text-[#555047] cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={condScope === 'specific'}
              onChange={(e) =>
                setCondition({
                  scope: e.target.checked ? 'specific' : 'property',
                })
              }
              className="rounded border-[#C8C1B4] text-[#386641] cursor-pointer"
            />
            {condResource === 'beds'
              ? 'Pick specific dorms instead'
              : condResource === 'rooms_beds'
                ? 'Pick specific rooms & beds instead'
                : `Pick specific ${condResource} instead`}
          </label>

          {(loc.scope === 'rooms' || loc.scope === 'units') && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <input value={roomSearch} onChange={(e) => setRoomSearch(e.target.value)}
                  placeholder="Search rooms…" className={`${inputCls} flex-1`} />
                <button type="button" onClick={() => setSub('location', { room_uids: zoneRooms.map((r) => r.room_uid) })}
                  className="text-xs font-medium text-[#386641] hover:underline cursor-pointer whitespace-nowrap">
                  Select all ({zoneRooms.length})
                </button>
                <button type="button" onClick={() => setSub('location', { room_uids: [] })}
                  className="text-xs font-medium text-[#8C867C] hover:underline cursor-pointer">
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5 max-h-44 overflow-y-auto p-0.5">
                {filteredRooms.map((r) => {
                  const sel = selectedRooms.includes(r.room_uid);
                  return (
                    <button key={r.room_uid} type="button" onClick={() => toggleRoom(r.room_uid)}
                      className={`px-2 py-2 rounded-[8px] border text-xs font-medium cursor-pointer transition-all ${
                        sel ? 'bg-[#EBF3EC] border-[#386641] text-[#244E2C]' : 'bg-white border-[#E2DCD0] text-[#58534C]'
                      }`}>
                      {r.room_number}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-[#8C867C] mt-1.5">{selectedRooms.length} selected</p>
            </div>
          )}

          {loc.scope === 'dorms' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-44 overflow-y-auto">
              {currentPropertyDorms.map((d) => {
                const sel = (loc.dorm_uids || []).includes(d.dorm_uid);
                return (
                  <button key={d.dorm_uid} type="button"
                    onClick={() => setSub('location', {
                      dorm_uids: sel ? (loc.dorm_uids || []).filter((x) => x !== d.dorm_uid)
                                     : [...(loc.dorm_uids || []), d.dorm_uid],
                    })}
                    className={`px-3 py-2.5 rounded-[8px] border text-xs font-medium text-left cursor-pointer ${
                      sel ? 'bg-[#EBF3EC] border-[#386641] text-[#244E2C]' : 'bg-white border-[#E2DCD0] text-[#58534C]'
                    }`}>
                    {d.name}
                  </button>
                );
              })}
            </div>
          )}

          {loc.scope === 'washrooms' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-44 overflow-y-auto">
              {currentPropertyWashrooms.map((w) => {
                const sel = (loc.washroom_uids || []).includes(w.washroom_uid);
                return (
                  <button key={w.washroom_uid} type="button"
                    onClick={() => setSub('location', {
                      washroom_uids: sel
                        ? (loc.washroom_uids || []).filter((x) => x !== w.washroom_uid)
                        : [...(loc.washroom_uids || []), w.washroom_uid],
                    })}
                    className={`px-3 py-2.5 rounded-[8px] border text-xs font-medium text-left cursor-pointer ${
                      sel ? 'bg-[#EBF3EC] border-[#386641] text-[#244E2C]' : 'bg-white border-[#E2DCD0] text-[#58534C]'
                    }`}>
                    {w.name}
                  </button>
                );
              })}
            </div>
          )}

          {(loc.scope === 'beds' || loc.scope === 'units') && (
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {currentPropertyDorms.map((d) => (
                <div key={d.dorm_uid}>
                  <p className="text-[11px] font-semibold text-[#8C867C] mb-1">{d.name}</p>
                  <div className="grid grid-cols-5 gap-1.5">
                    {d.beds.map((b) => {
                      const sel = (loc.bed_uids || []).includes(b.bed_uid);
                      return (
                        <button key={b.bed_uid} type="button"
                          onClick={() => setSub('location', {
                            bed_uids: sel ? (loc.bed_uids || []).filter((x) => x !== b.bed_uid)
                                          : [...(loc.bed_uids || []), b.bed_uid],
                          })}
                          className={`px-2 py-1.5 rounded-[8px] border text-xs cursor-pointer ${
                            sel ? 'bg-[#EBF3EC] border-[#386641] text-[#244E2C]' : 'bg-white border-[#E2DCD0] text-[#58534C]'
                          }`}>
                          {b.bed_number}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Human-readable condition summary — the rule, not a snapshot */}
          <div className="rounded-[10px] bg-[#F7F4EF] border border-[#EAE5DC] px-3.5 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8C867C] mb-1">
              Condition
            </p>
            <p className="text-[13px] text-[#555047] leading-snug">
              {conditionSummary()}
            </p>
            <p className="text-[11px] text-[#8C867C] mt-1">
              Targets are re-evaluated every run — today&rsquo;s occupied rooms
              can differ from tomorrow&rsquo;s.
            </p>
          </div>
        </div>
      )}

      {/* ======================== STEP 4 — SCHEDULE ======================== */}
      {step === 3 && (
        <div className="space-y-4">
          <Segmented
            value={sched.kind}
            onChange={(kind) => setSub('schedule', { kind })}
            options={[
              { v: 'one_time' as const, l: 'One Time', hint: 'Runs once on a date' },
              { v: 'recurring' as const, l: 'Recurring', hint: 'Repeats on a schedule' },
            ]}
          />

          {sched.kind === 'one_time' && (
            <div className="grid grid-cols-3 gap-3.5">
              <div>
                <label className={labelCls}>Date *</label>
                <input type="date" value={sched.date || ''} onChange={(e) => setSub('schedule', { date: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Start Time</label>
                <input type="time" value={sched.time || ''} onChange={(e) => setSub('schedule', { time: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>End Time</label>
                <input type="time" value={sched.end_time || ''} onChange={(e) => setSub('schedule', { end_time: e.target.value })} className={inputCls} />
              </div>
            </div>
          )}

          {sched.kind === 'recurring' && (
            <>
              <div>
                <label className={labelCls}>Repeat</label>
                <div className="flex flex-wrap gap-2">
                  {(['hourly', 'daily', 'weekly', 'monthly', 'custom'] as const).map((f) => (
                    <button key={f} type="button" onClick={() => setSub('schedule', { frequency: f })}
                      className={`px-3.5 py-2 rounded-[10px] border text-[13px] font-medium cursor-pointer ${
                        sched.frequency === f ? 'bg-[#EBF3EC] border-[#386641] text-[#244E2C]' : 'bg-white border-[#E2DCD0] text-[#58534C]'
                      }`}>
                      {f[0].toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {sched.frequency === 'hourly' && (
                <div className="grid grid-cols-3 gap-3.5">
                  <div>
                    <label className={labelCls}>Every (hours)</label>
                    <input type="number" min={1} max={12} value={sched.every || 1}
                      onChange={(e) => setSub('schedule', { every: parseInt(e.target.value) || 1 })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Start Time</label>
                    <input type="time" value={sched.start_time || ''} onChange={(e) => setSub('schedule', { start_time: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>End Time</label>
                    <input type="time" value={sched.window_end || ''} onChange={(e) => setSub('schedule', { window_end: e.target.value })} className={inputCls} />
                  </div>
                </div>
              )}

              {sched.frequency === 'daily' && (
                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <label className={labelCls}>Every (days)</label>
                    <input type="number" min={1} value={sched.every || 1}
                      onChange={(e) => setSub('schedule', { every: parseInt(e.target.value) || 1 })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Time</label>
                    <input type="time" value={sched.time || ''} onChange={(e) => setSub('schedule', { time: e.target.value })} className={inputCls} />
                  </div>
                </div>
              )}

              {sched.frequency === 'weekly' && (
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>On these days</label>
                    <div className="flex gap-1.5">
                      {WEEKDAYS.map((d, i) => {
                        const sel = (sched.weekdays || []).includes(i);
                        return (
                          <button key={d} type="button"
                            onClick={() => setSub('schedule', {
                              weekdays: sel ? (sched.weekdays || []).filter((x) => x !== i)
                                            : [...(sched.weekdays || []), i],
                            })}
                            className={`w-10 h-10 rounded-[9px] border text-xs font-semibold cursor-pointer ${
                              sel ? 'bg-[#386641] border-[#386641] text-white' : 'bg-white border-[#E2DCD0] text-[#58534C]'
                            }`}>
                            {d[0]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="w-48">
                    <label className={labelCls}>Time</label>
                    <input type="time" value={sched.time || ''} onChange={(e) => setSub('schedule', { time: e.target.value })} className={inputCls} />
                  </div>
                </div>
              )}

              {sched.frequency === 'monthly' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3.5">
                    <div>
                      <label className={labelCls}>Day of month</label>
                      <select value={sched.day_of_month || ''}
                        onChange={(e) => setSub('schedule', { day_of_month: parseInt(e.target.value) || undefined, relative_week: undefined, relative_weekday: undefined })}
                        className={`${inputCls} cursor-pointer`}>
                        <option value="">Choose…</option>
                        {[1, 5, 10, 15, 20, 28, 30].map((d) => <option key={d} value={d}>{d}{d === 1 ? 'st' : 'th'}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>…or relative day</label>
                      <div className="flex gap-1.5">
                        <select value={sched.relative_week || ''}
                          onChange={(e) => setSub('schedule', { relative_week: (e.target.value || undefined) as never, day_of_month: undefined })}
                          className={`${inputCls} cursor-pointer`}>
                          <option value="">—</option>
                          {['first', 'second', 'third', 'fourth', 'last'].map((w) => <option key={w} value={w}>{w}</option>)}
                        </select>
                        <select value={sched.relative_weekday ?? ''}
                          onChange={(e) => setSub('schedule', { relative_weekday: e.target.value === '' ? undefined : parseInt(e.target.value) })}
                          className={`${inputCls} cursor-pointer`}>
                          <option value="">—</option>
                          {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="w-48">
                    <label className={labelCls}>Time</label>
                    <input type="time" value={sched.time || ''} onChange={(e) => setSub('schedule', { time: e.target.value })} className={inputCls} />
                  </div>
                </div>
              )}

              {sched.frequency === 'custom' && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#58534C]">Every</span>
                  <input type="number" min={1} value={sched.every || 1}
                    onChange={(e) => setSub('schedule', { every: parseInt(e.target.value) || 1 })}
                    className="w-20 px-3 py-2.5 text-sm bg-white border border-[#E2DCD0] rounded-[10px]" />
                  <select value={sched.custom_unit || 'days'}
                    onChange={(e) => setSub('schedule', { custom_unit: e.target.value as 'days' | 'weeks' | 'months' })}
                    className={`${inputCls} w-32 cursor-pointer`}>
                    <option value="days">days</option>
                    <option value="weeks">weeks</option>
                    <option value="months">months</option>
                  </select>
                  <input type="time" value={sched.time || ''} onChange={(e) => setSub('schedule', { time: e.target.value })} className={`${inputCls} w-36`} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3.5 pt-3 border-t border-[#F0ECE4]">
                <div>
                  <label className={labelCls}>Start Date</label>
                  <input type="date" value={sched.start_date || ''} onChange={(e) => setSub('schedule', { start_date: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>End Date <span className="normal-case font-normal">(optional)</span></label>
                  <input type="date" value={sched.end_date || ''} onChange={(e) => setSub('schedule', { end_date: e.target.value })} className={inputCls} />
                </div>
              </div>
              <p className="text-[11px] text-[#8C867C]">Timezone: {activeProperty?.city || 'Property'} time ({tzLabel})</p>
            </>
          )}
        </div>
      )}

      {/* ======================== STEP 5 — INSTRUCTIONS ======================== */}
      {step === 4 && (
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Checklist</label>
            <div className="flex gap-2 mb-2">
              <input value={newItem} onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addChecklistItem())}
                placeholder="e.g. Check room lighting" className={`${inputCls} flex-1`} />
              <Button variant="outline" size="sm" onClick={addChecklistItem}>
                <Plus className="w-3.5 h-3.5" /> Add
              </Button>
            </div>
            <div className="space-y-1.5">
              {(form.checklist || []).map((item, i) => (
                <div
                  key={i}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragIdx !== null && dragIdx !== i) moveItem(dragIdx, i); setDragIdx(null); }}
                  className="flex items-center gap-2 px-2.5 py-2 bg-[#FAF8F5] border border-[#EAE5DC] rounded-[9px]"
                >
                  <GripVertical className="w-3.5 h-3.5 text-[#C8C1B4] cursor-grab" />
                  <span className="flex-1 text-[13px] text-[#35322E]">{item.title}</span>
                  <label className="flex items-center gap-1 text-[11px] text-[#8C867C] cursor-pointer">
                    <input type="checkbox" checked={item.required}
                      onChange={(e) => {
                        const items = [...(form.checklist || [])];
                        items[i] = { ...item, required: e.target.checked };
                        set({ checklist: items });
                      }}
                      className="accent-[#386641]" />
                    required
                  </label>
                  <button type="button"
                    onClick={() => set({ checklist: (form.checklist || []).filter((_, j) => j !== i) })}
                    className="p-1 text-[#C8C1B4] hover:text-[#B91C1C] cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {!(form.checklist || []).length && (
                <p className="text-xs text-[#A59F95] py-4 text-center border border-dashed border-[#E2DCD0] rounded-[9px]">
                  No checklist items — add steps the worker should complete.
                </p>
              )}
            </div>
            <p className="text-[10.5px] text-[#8C867C] mt-1.5">Drag items to reorder — saved when you create the template.</p>
          </div>
        </div>
      )}

      {/* ======================== STEP 6 — VERIFY ======================== */}
      {step === 5 && (
        <div className="space-y-5">
          <div>
            <label className={labelCls}>Completion is verified by…</label>
            <div className="space-y-2">
              {([
                { k: 'checklist_required', l: 'Checklist completion', hint: 'All required items ticked' },
                { k: 'photo_required', l: 'Photo evidence', hint: 'Worker uploads photos' },
                { k: 'supervisor_approval', l: 'Supervisor approval', hint: 'Work enters pending review' },
              ] as const).map((o) => (
                <label key={o.k} className="flex items-center gap-3 px-3.5 py-2.5 bg-white border border-[#E2DCD0] rounded-[10px] cursor-pointer hover:border-[#C8C1B4]">
                  <input type="checkbox"
                    checked={Boolean(form.verification?.[o.k])}
                    onChange={(e) => setSub('verification', { [o.k]: e.target.checked })}
                    className="w-4 h-4 accent-[#386641]" />
                  <span className="flex-1">
                    <span className="block text-[13px] font-medium text-[#35322E]">{o.l}</span>
                    <span className="block text-[11px] text-[#8C867C]">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {form.verification?.photo_required && (
            <div className="grid grid-cols-2 gap-3.5 pl-2">
              <div>
                <label className={labelCls}>Min photos</label>
                <input type="number" min={1} max={10} value={form.verification?.min_photos || 1}
                  onChange={(e) => setSub('verification', { min_photos: parseInt(e.target.value) || 1 })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Max photos</label>
                <input type="number" min={1} max={10} value={form.verification?.max_photos || 5}
                  onChange={(e) => setSub('verification', { max_photos: parseInt(e.target.value) || 5 })} className={inputCls} />
              </div>
            </div>
          )}

          <div>
            <label className={labelCls}>If the work is late…</label>
            <div className="grid grid-cols-2 gap-2">
              {OVERDUE_ACTIONS.map((o) => {
                const sel = (form.overdue?.actions || []).includes(o.v);
                return (
                  <button key={o.v} type="button"
                    onClick={() => setSub('overdue', {
                      actions: sel ? (form.overdue?.actions || []).filter((x) => x !== o.v)
                                   : [...(form.overdue?.actions || []), o.v],
                    })}
                    className={`px-3 py-2 rounded-[10px] border text-[12.5px] font-medium text-left cursor-pointer ${
                      sel ? 'bg-[#FDF6EC] border-[#D9A441] text-[#7A5410]' : 'bg-white border-[#E2DCD0] text-[#58534C]'
                    }`}>
                    {o.l}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-2.5">
              <span className="text-xs text-[#8C867C]">after</span>
              <input type="number" min={5} value={form.overdue?.threshold_minutes || 30}
                onChange={(e) => setSub('overdue', { threshold_minutes: parseInt(e.target.value) || 30 })}
                className="w-20 px-2.5 py-1.5 text-xs bg-white border border-[#E2DCD0] rounded-[8px]" />
              <span className="text-xs text-[#8C867C]">minutes overdue</span>
              {(form.overdue?.actions || []).includes('auto_reassign') && (
                <select value={form.overdue?.reassign_method || 'next_zone_employee'}
                  onChange={(e) => setSub('overdue', { reassign_method: e.target.value as never })}
                  className={`${inputCls} w-48 !py-1.5 text-xs cursor-pointer`}>
                  <option value="next_zone_employee">Next zone employee</option>
                  <option value="supervisor">To supervisor</option>
                  <option value="manual">Manual reassignment</option>
                </select>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======================== STEP 7 — REVIEW ======================== */}
      {step === 6 && (
        <div className="space-y-4">
          <div className="rounded-[12px] border border-[#EAE5DC] overflow-hidden">
            <div className="px-4 py-3 bg-[#F6F4EF] border-b border-[#EAE5DC]">
              <p className="font-semibold text-[15px] text-[#24221F]">{form.name || 'Untitled'}</p>
              <p className="text-xs text-[#8C867C] mt-0.5">{form.description || 'No description'}</p>
            </div>
            <dl className="divide-y divide-[#F0ECE4] text-[13px]">
              {[
                ['WORK TYPE', `${WORK_TYPES.find((t) => t.v === form.template_type)?.l || LEGACY_TYPE_LABELS[form.template_type] || form.template_type} · ${(form.category || '').replace('_', ' ')} · ${form.priority} priority`],
                ['ASSIGNMENT', assign.mode === 'automatic'
                  ? `Automatic — ${assign.method === 'zone_round_robin' ? 'zone round-robin' : assign.method?.replace(/_/g, ' ')}`
                  : assign.mode === 'individual'
                    ? `Individual — ${currentPropertyEmployees.find((e) => e.employee_uid === assign.employee_uid)?.name || '?'}`
                    : `Team — ${assign.team || '?'}`],
                ['LOCATION', (() => {
                  if (loc.scope === 'zone') {
                    const z = currentPropertyZones.find((z) => z.zone_uid === loc.zone_uid);
                    return `${z?.name || 'Zone'} — ${{ rooms: 'all rooms', dorms: 'all dorms', beds: 'all beds', units: 'all units' }[loc.target || 'rooms']}`;
                  }
                  if (loc.scope === 'area') return `Area — ${currentPropertyAreas.find((a) => a.area_uid === loc.area_uid)?.name || '?'}`;
                  if (loc.scope === 'rooms') return `${(loc.room_uids || []).length} room(s)`;
                  if (loc.scope === 'dorms') return `${(loc.dorm_uids || []).length} dorm(s)`;
                  if (loc.scope === 'beds') return `${(loc.bed_uids || []).length} bed(s)`;
                  return 'Entire property';
                })()],
                ['SCHEDULE', (() => {
                  if (sched.kind !== 'recurring') return `One time — ${sched.date || '?'}${sched.time ? ` at ${sched.time}` : ''}`;
                  const t = sched.time ? ` at ${sched.time}` : '';
                  if (sched.frequency === 'hourly') return `Every ${sched.every || 1}h, ${sched.start_time || '00:00'}–${sched.window_end || '23:59'}`;
                  if (sched.frequency === 'daily') return `Every ${(sched.every || 1) > 1 ? `${sched.every} days` : 'day'}${t}`;
                  if (sched.frequency === 'weekly') return `Weekly on ${(sched.weekdays || []).map((d) => WEEKDAYS[d]).join(', ')}${t}`;
                  if (sched.frequency === 'monthly') return `Monthly${sched.day_of_month ? ` on day ${sched.day_of_month}` : sched.relative_week ? ` on ${sched.relative_week} ${WEEKDAYS[sched.relative_weekday ?? 0]}` : ''}${t}`;
                  return `Every ${sched.every || 1} ${sched.custom_unit || 'days'}`;
                })()],
                ['DURATION', form.duration_minutes ? `${form.duration_minutes} minutes` : 'Not set'],
                ['CHECKLIST', `${(form.checklist || []).length} item(s)`],
                ['VERIFICATION', [
                  form.verification?.checklist_required && 'checklist',
                  form.verification?.photo_required && `photo (${form.verification?.min_photos || 1}–${form.verification?.max_photos || 5})`,
                  form.verification?.supervisor_approval && 'supervisor approval',
                ].filter(Boolean).join(' + ') || 'Self confirmation'],
                ['OVERDUE', ((form.overdue?.actions || []).map((a) => a.replace(/_/g, ' ')).join(', ') || 'Nothing') + ` after ${form.overdue?.threshold_minutes || 30} min`],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[110px_1fr] px-4 py-2.5">
                  <dt className="text-[10.5px] font-semibold text-[#8C867C] tracking-wider pt-0.5">{k}</dt>
                  <dd className="text-[#35322E]">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="text-[11px] text-[#8C867C]">
            Drafts don't generate work. Activating starts the schedule — the backend generates
            tasks and assigns them automatically.
          </p>
        </div>
      )}
    </Modal>
  );
};

export default TemplateWizard;

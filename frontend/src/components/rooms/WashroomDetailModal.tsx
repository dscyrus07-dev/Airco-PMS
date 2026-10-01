import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  History,
  LayoutGrid,
  Loader2,
  MoreVertical,
  Pencil,
  RefreshCw,
  Sparkles,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Badge, unitVisualState } from '../ui/Badge';
import { Dorm, Washroom, WashroomFixture, Zone } from '../../types';
import { isBlockingTicket } from '../../lib/maintenanceUtils';
import {
  FIXTURE_STATUS_DOT,
  FIXTURE_STATUS_LABEL,
  FIXTURE_STATUS_TEXT,
  FIXTURE_CONDITION,
  buildFixtureGroups,
  fixtureMeta,
  fixtureTypeLabel,
  fmtTimestamp,
  isCustomKind,
  summarize,
} from '../../lib/washroomFixtures';
import { AssignWashroomTaskModal } from './AssignWashroomTaskModal';
import { ScheduleWashroomMaintenanceModal } from './ScheduleWashroomMaintenanceModal';

interface WashroomDetailModalProps {
  /** Real washroom resource — null when only a declared facility exists. */
  washroom: Washroom | null;
  /** Declared facility label (dorm.washroom) when no resource exists. */
  declaredName: string | null;
  dorm: Dorm | null;
  zone: Zone | null;
  onClose: () => void;
  onEdit?: (washroom: Washroom) => void;

  /** Create a real washroom resource for a declared-only facility */
  onConfigure?: () => void;
}

const STATUS_BADGE: Record<string, 'sage' | 'orange' | 'red' | 'neutral'> = {
  available: 'sage',
  cleaning: 'orange',
  maintenance: 'red',
  inactive: 'neutral',
};

const STATUS_TEXT: Record<string, string> = {
  available: 'Operational',
  cleaning: 'Cleaning',
  maintenance: 'Maintenance',
  inactive: 'Inactive',
};

const sectionLabel =
  'text-[10px] font-semibold text-[#8C867C] uppercase tracking-wider font-body';

// ---------------------------------------------------------------------------
// Fixture `···` menu — real status mutations + workflow shortcuts
// ---------------------------------------------------------------------------

interface FixtureMenuProps {
  fixture: WashroomFixture;
  disabled: boolean;
  onAction: (action: string, f: WashroomFixture) => void;
}

const FixtureMenu: React.FC<FixtureMenuProps> = ({ fixture, disabled, onAction }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const items: { key: string; label: string; icon: LucideIcon }[] = [
    { key: 'details', label: 'View Details', icon: LayoutGrid },
    { key: 'task', label: 'Assign Task', icon: ClipboardCheck },
    { key: 'maintenance', label: 'Allocate Maintenance', icon: Wrench },
    { key: 'operational', label: 'Mark Operational', icon: RefreshCw },
    { key: 'inactive', label: 'Mark Inactive', icon: X },
  ];

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="w-5 h-5 flex items-center justify-center rounded-[5px] text-[#8C867C] opacity-0 group-hover:opacity-100 hover:bg-[#F2ECE3] hover:text-[#24221F] transition-all cursor-pointer disabled:hidden"
        title="Fixture actions"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-30 w-52 rounded-[10px] border border-[#E4DFD5] bg-white shadow-lg py-1">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={() => {
                setOpen(false);
                onAction(it.key, fixture);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-[#45413B] hover:bg-[#FAF8F5] transition-colors cursor-pointer"
            >
              <it.icon className="w-3.5 h-3.5 text-[#8C867C]" />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------

export const WashroomDetailModal: React.FC<WashroomDetailModalProps> = ({
  washroom: propWashroom,
  declaredName,
  dorm,
  zone,
  onClose,
  onEdit,

  onConfigure,
}) => {
  const {
    currentPropertyMaintenance,
    currentPropertyTasks,
    currentPropertyWashrooms,
    refreshWashroom,
    updateWashroomFixture,
    bulkUpdateUnits,
    addToast,
  } = useApp();

  // The prop is a snapshot captured when the modal opened — callers keep it
  // in their own state, so fixture edits would render stale data. Resolve
  // the live record from context; every status mutation lands there.
  const washroom = useMemo(() => {
    if (!propWashroom) return null;
    return (
      currentPropertyWashrooms.find(
        (w) => w.washroom_uid === propWashroom.washroom_uid
      ) ?? propWashroom
    );
  }, [propWashroom, currentPropertyWashrooms]);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [selectedFixture, setSelectedFixture] = useState<WashroomFixture | null>(null);
  const [taskFixture, setTaskFixture] = useState<WashroomFixture | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const [maintFixture, setMaintFixture] = useState<WashroomFixture | null>(null);
  const [maintOpen, setMaintOpen] = useState(false);
  // Click-to-select — each fixture toggles; all selections kept at once
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Revalidate the live record on open — the DB is the source of truth.
  useEffect(() => {
    if (!washroom) return;
    setRefreshing(true);
    setRefreshFailed(false);
    refreshWashroom(washroom.washroom_uid).then((w) => {
      setRefreshing(false);
      if (!w) setRefreshFailed(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [washroom?.washroom_uid]);

  const name = washroom?.name || declaredName || 'Washroom';
  const facilityLabel = washroom?.washroom_type
    ? `${washroom.washroom_type.charAt(0).toUpperCase()}${washroom.washroom_type.slice(1)} Washroom`
    : declaredName || 'Attached Washroom';
  const status = washroom?.status || 'available';

  // Real fixture records — the only source.
  const fixtures = useMemo(() => washroom?.fixtures ?? [], [washroom]);
  const groups = useMemo(() => buildFixtureGroups(fixtures), [fixtures]);
  const summary = useMemo(() => summarize(fixtures), [fixtures]);
  // 'needs_cleaning' is task-driven — a fixture needing cleaning shows up
  // via an open task (Assign Task), not a stored fixture state.
  const attention = fixtures.filter((f) => f.status === 'maintenance');

  // Keep the selected fixture pointing at the live record after mutations.
  const liveSelected = selectedFixture
    ? fixtures.find((f) => f.fixture_uid === selectedFixture.fixture_uid) ?? null
    : null;

  // Fixture → open maintenance tickets (real mapping)
  const fixtureTickets = useMemo(() => {
    const map = new Map<string, { issue: string; due_date?: string; assigned_to_name?: string }>();
    for (const t of currentPropertyMaintenance) {
      if (
        t.washroom_uid === washroom?.washroom_uid &&
        t.washroom_fixture_uid &&
        isBlockingTicket(t.status)
      ) {
        map.set(t.washroom_fixture_uid, t);
      }
    }
    return map;
  }, [currentPropertyMaintenance, washroom]);

  // Maintenance tickets that target the washroom itself (not a fixture)
  const washroomTickets = useMemo(
    () =>
      washroom
        ? currentPropertyMaintenance.filter(
            (t) => t.washroom_uid === washroom.washroom_uid
          )
        : [],
    [washroom, currentPropertyMaintenance]
  );
  const activeWashroomTicket = washroomTickets.find(
    (t) => isBlockingTicket(t.status) && !t.washroom_fixture_uid
  );

  // Recent activity — real tasks + real maintenance tickets only
  const activity = useMemo(() => {
    if (!washroom) return [];
    const items: { time: string; ts: number; icon: 'task' | 'maintenance'; text: string; actor?: string }[] = [];
    for (const t of currentPropertyTasks) {
      if (t.washroom_uid !== washroom.washroom_uid) continue;
      const scope = t.washroom_fixture_label || 'washroom';
      items.push({
        time: fmtTimestamp(t.created_at),
        ts: t.created_at ? new Date(t.created_at).getTime() : 0,
        icon: 'task',
        text: `${t.ticket_number ? `${t.ticket_number} — ` : ''}${t.title} (${scope})`,
        actor: t.assigned_to_name || undefined,
      });
      if (t.completed_at) {
        items.push({
          time: fmtTimestamp(t.completed_at),
          ts: new Date(t.completed_at).getTime(),
          icon: 'task',
          text: `${t.title} completed (${scope})`,
          actor: t.assigned_to_name || undefined,
        });
      }
    }
    for (const t of washroomTickets) {
      const scope = t.washroom_fixture_label || 'Entire washroom';
      items.push({
        time: fmtTimestamp(t.created_at),
        ts: t.created_at ? new Date(t.created_at).getTime() : 0,
        icon: 'maintenance',
        text: `${t.ticket_number} — ${t.issue} (${scope})`,
        actor: t.assigned_to_name || t.reported_by_name || undefined,
      });
      if (t.resolved_at) {
        items.push({
          time: fmtTimestamp(t.resolved_at),
          ts: new Date(t.resolved_at).getTime(),
          icon: 'maintenance',
          text: `${t.ticket_number} resolved (${scope})`,
          actor: t.assigned_to_name || undefined,
        });
      }
    }
    return items.sort((a, b) => b.ts - a.ts).slice(0, 6);
  }, [washroom, currentPropertyTasks, washroomTickets]);

  // Canonical resolver drives the condition — fixture-level maintenance
  // still shows 'Maintenance Required' from the real summary.
  const overallCondition = (() => {
    if (washroom) {
      const visual = unitVisualState(washroom);
      if (visual === 'red' || summary.maintenance > 0)
        return 'Maintenance Required';
      if (visual === 'beige') return 'Cleaning In Progress';
      if (visual === 'neutral') return 'Inactive';
      return 'Operational';
    }
    return summary.maintenance > 0 || status === 'maintenance'
      ? 'Maintenance Required'
      : status === 'cleaning'
      ? 'Cleaning In Progress'
      : 'Operational';
  })();

  const selectedFixtures = useMemo(
    () => fixtures.filter((f) => selectedIds.has(f.fixture_uid)),
    [fixtures, selectedIds]
  );

  const toggleSelect = (f: WashroomFixture) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(f.fixture_uid)) next.delete(f.fixture_uid);
      else next.add(f.fixture_uid);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // Fixtures can disappear via Edit — prune stale selection automatically
  useEffect(() => {
    setSelectedIds((prev) => {
      const live = new Set(fixtures.map((f) => f.fixture_uid));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [fixtures]);

  const openTask = (f: WashroomFixture | null) => {
    setTaskFixture(f);
    setTaskOpen(true);
  };
  const openMaint = (f: WashroomFixture | null) => {
    setMaintFixture(f);
    setMaintOpen(true);
  };

  const bulkTask = () => {
    if (selectedFixtures.length === 0) return;
    setTaskFixture(selectedFixtures[0]); // preset first; modal handles the list
    setTaskOpen(true);
  };
  const bulkMaint = () => {
    if (selectedFixtures.length === 0) return;
    setMaintFixture(selectedFixtures[0]);
    setMaintOpen(true);
  };
  const bulkStatus = async (
    status: 'operational' | 'inactive'
  ) => {
    if (!washroom || selectedFixtures.length === 0) return;
    for (const f of selectedFixtures) {
      await updateWashroomFixture(washroom.washroom_uid, f.fixture_uid, status);
    }
    clearSelection();
  };

  const fixtureAction = (action: string, f: WashroomFixture) => {
    switch (action) {
      case 'details':
        setSelectedFixture(f);
        break;
      case 'task':
        openTask(f);
        break;
      case 'maintenance':
        openMaint(f);
        break;
      case 'operational':
        if (washroom) {
          void updateWashroomFixture(washroom.washroom_uid, f.fixture_uid, 'operational');
        }
        break;
      case 'inactive':
        if (washroom) {
          void updateWashroomFixture(washroom.washroom_uid, f.fixture_uid, 'inactive');
        }
        break;
    }
  };

  const retryRefresh = () => {
    if (!washroom) return;
    setRefreshing(true);
    setRefreshFailed(false);
    refreshWashroom(washroom.washroom_uid).then((w) => {
      setRefreshing(false);
      if (!w) setRefreshFailed(true);
    });
  };

  // Declared-facility path — no washroom resource exists; show honest empty state
  if (!washroom) {
    return (
      <Modal
        isOpen
        onClose={onClose}
        title={facilityLabel}
        maxWidth="md"
        footer={
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-[8px] text-xs font-semibold bg-[#386641] text-white hover:bg-[#2C5134] transition-colors cursor-pointer"
          >
            Close
          </button>
        }
      >
        <div className="flex items-center gap-2 flex-wrap text-xs text-[#6C675F] mb-4">
          <span className="font-semibold text-[#24221F]">{dorm?.name || 'Zone Facility'}</span>
          <span>·</span>
          <span>{zone?.name || 'Unallocated'}</span>
          <span>·</span>
          <span>{facilityLabel}</span>
        </div>
        <div className="rounded-[12px] border border-dashed border-[#DDD7CB] bg-[#FAF8F5] px-4 py-6 text-center">
          <p className="text-sm font-medium text-[#45413B]">
            No washroom resource configured
          </p>
          <p className="text-xs text-[#8C867C] mt-1 max-w-sm mx-auto">
            This dorm declares an {declaredName?.toLowerCase() || 'attached'} facility,
            but no washroom record exists in {zone?.name || 'this zone'} yet.
            Create a washroom to manage its fixtures, tasks and maintenance.
          </p>
          {onConfigure && (
            <button
              type="button"
              onClick={onConfigure}
              className="mt-3 px-3.5 py-2 rounded-[9px] text-xs font-semibold bg-[#386641] text-white hover:bg-[#2C5134] transition-colors cursor-pointer inline-flex items-center gap-1.5"
            >
              <Pencil className="w-3.5 h-3.5" />
              Configure Washroom
            </button>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
        title={facilityLabel}
        maxWidth="2xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(washroom)}
                className="px-3 py-1.5 rounded-[8px] text-xs font-semibold bg-[#F2ECE3] text-[#555047] hover:bg-[#E5DFD4] transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit Washroom
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-[8px] text-xs font-semibold bg-[#386641] text-white hover:bg-[#2C5134] transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        }
      >
        {/* Facility header — context + status + visible edit */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-center gap-2 flex-wrap text-xs text-[#6C675F]">
            <span className="font-semibold text-[#24221F]">{dorm?.name || 'Zone Facility'}</span>
            <span>·</span>
            <span>{zone?.name || 'Unallocated'}</span>
            <span>·</span>
            <span>{facilityLabel}</span>
            <Badge variant={STATUS_BADGE[status] || 'neutral'} size="sm">
              {STATUS_TEXT[status] || status}
            </Badge>
            {refreshing && (
              <Loader2 className="w-3 h-3 animate-spin text-[#8C867C]" />
            )}
          </div>
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(washroom)}
              className="px-3 py-1.5 rounded-[8px] text-xs font-semibold border border-[#DDD7CB] bg-white text-[#24221F] hover:border-[#386641] hover:text-[#386641] transition-colors cursor-pointer inline-flex items-center gap-1.5"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit Washroom
            </button>
          )}
        </div>

        {refreshFailed && (
          <div className="mb-4 rounded-[10px] border border-[#F0DFA8] bg-[#FDF6E3] px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-[#8A6D1D]">
              Unable to load the latest washroom details — showing the last
              known record.
            </span>
            <button
              type="button"
              onClick={retryRefresh}
              className="px-2 py-1 rounded-[7px] text-[11px] font-semibold bg-white border border-[#E0CD8C] text-[#8A6D1D] hover:bg-[#FDF3D0] transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Washroom-level maintenance banner — real tickets only */}
        {activeWashroomTicket && (
          <div className="mb-4 rounded-[10px] border border-[#F2D6D6] bg-[#FDF1F1] px-3 py-2 flex items-center gap-2.5">
            <Wrench className="w-4 h-4 text-[#A32A2A]" />
            <div className="text-xs">
              <span className="font-semibold text-[#A32A2A]">
                Maintenance {activeWashroomTicket.status}
              </span>
              <span className="text-[#6C675F]">
                {' '}· {activeWashroomTicket.ticket_number} — {activeWashroomTicket.issue}
                {activeWashroomTicket.assigned_to_name &&
                  ` · Assigned to ${activeWashroomTicket.assigned_to_name}`}
                {activeWashroomTicket.due_date && ` · Due ${activeWashroomTicket.due_date}`}
              </span>
            </div>
          </div>
        )}

        {/* Action bar */}
        <div className="flex items-center gap-2 flex-wrap mb-5">
          <span className={`${sectionLabel} mr-1`}>Washroom Actions</span>
          <button
            type="button"
            onClick={() => openTask(null)}
            className="px-3 py-1.5 rounded-[8px] text-xs font-semibold bg-[#386641] text-white hover:bg-[#2C5134] transition-colors cursor-pointer inline-flex items-center gap-1.5"
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            Assign Task
          </button>
          <button
            type="button"
            onClick={() => openMaint(null)}
            className="px-3 py-1.5 rounded-[8px] text-xs font-semibold bg-[#FDE8E8] text-[#A32A2A] hover:bg-[#FBDCDC] transition-colors cursor-pointer inline-flex items-center gap-1.5"
          >
            <Wrench className="w-3.5 h-3.5" />
            Allocate Maintenance
          </button>
          <button
            type="button"
            disabled={!washroom || washroom.status === 'available'}
            onClick={() =>
              washroom &&
              void bulkUpdateUnits({
                action: 'available',
                washroomUids: [washroom.washroom_uid],
              })
            }
            className={`px-3 py-1.5 rounded-[8px] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
              washroom && washroom.status !== 'available'
                ? 'bg-[#EBF3EC] text-[#244E2C] hover:bg-[#DCEBDE] cursor-pointer'
                : 'bg-[#F4F1EA] text-[#C4BDB1] cursor-not-allowed'
            }`}
            title={
              washroom?.status === 'available'
                ? 'Already available'
                : 'Release to Available — closes blocking cleaning/maintenance work'
            }
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Available
          </button>
        </div>

        {/* Facility Overview — real counts */}
        <div className="mb-5">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <span className={sectionLabel}>Facility Overview</span>
            <span className="text-[11px] text-[#8C867C]">
              Overall:{' '}
              <span className="font-semibold text-[#24221F]">{overallCondition}</span>
            </span>
          </div>
          <div className="rounded-[12px] border border-[#EAE5DC] bg-white p-3">
            <div className="flex items-center gap-4 flex-wrap text-xs pb-3 mb-3 border-b border-[#F2ECE3]">
              <span className="font-bold text-sm text-[#24221F]">
                {summary.total} Fixtures
              </span>
              <span className="inline-flex items-center gap-1.5 font-medium text-[#2E6038]">
                <span className="w-2 h-2 rounded-full bg-[#386641]" />
                {summary.operational} Operational
              </span>
              <span className="inline-flex items-center gap-1.5 font-medium text-[#A32A2A]">
                <span className="w-2 h-2 rounded-full bg-[#C53B3B]" />
                {summary.maintenance} Maintenance
              </span>
              <span className="inline-flex items-center gap-1.5 font-medium text-[#736E65]">
                <span className="w-2 h-2 rounded-full bg-[#A59F95]" />
                {summary.inactive} Inactive
              </span>
            </div>
            {groups.length === 0 ? (
              <p className="text-xs text-[#8C867C] py-2">
                No fixtures have been configured for this washroom.
              </p>
            ) : (
              <div
                className="grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(groups.length, 6)}, minmax(0, 1fr))`,
                }}
              >
                {groups.map((g) => {
                  const meta = fixtureMeta(g.kind, g.isCustom);
                  const Icon = meta.icon;
                  const ok = g.fixtures.filter((f) => f.status === 'operational').length;
                  const attn = g.fixtures.length - ok;
                  return (
                    <div
                      key={g.kind}
                      className="rounded-[10px] border border-[#EAE5DC] bg-[#FAF8F5] px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2 text-[#555047]">
                        <Icon className="w-4 h-4" />
                        <span className="text-xs font-semibold truncate">
                          {meta.plural}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5">
                        <span className="text-xl font-bold text-[#24221F]">
                          {g.fixtures.length}
                        </span>
                        <span className="text-[10px] text-[#8C867C]">total</span>
                      </div>
                      <div className="text-[10px] mt-0.5">
                        <span className="font-medium text-[#2E6038]">{ok} operational</span>
                        {attn > 0 && (
                          <span className="font-medium text-[#9A4C07]"> · {attn} attention</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Needs Attention — real flags only */}
        <div className="mb-5">
          <span className={`${sectionLabel} block mb-2`}>Needs Attention</span>
          {attention.length === 0 ? (
            <div className="rounded-[10px] border border-[#EAE5DC] bg-[#EBF3EC]/60 px-3 py-2.5 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#386641]" />
              <span className="text-xs font-medium text-[#244E2C]">
                {fixtures.length === 0
                  ? 'No fixtures configured — nothing to monitor.'
                  : 'All fixtures operational — no outstanding cleaning or maintenance issues.'}
              </span>
            </div>
          ) : (
            <div className="rounded-[10px] border border-[#EAE5DC] divide-y divide-[#F2ECE3] overflow-hidden">
              {attention.map((f) => {
                const Ic = fixtureMeta(f.fixture_type, isCustomKind(f.fixture_type)).icon;
                return (
                  <div
                    key={f.fixture_uid}
                    className="flex items-center justify-between gap-2 px-3 py-2 bg-white"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Ic className="w-4 h-4 text-[#555047] shrink-0" />
                      <span className="text-xs font-semibold text-[#24221F] truncate">
                        {f.label}
                      </span>
                      <span className={`text-[11px] font-medium ${FIXTURE_STATUS_TEXT[f.status]}`}>
                        {FIXTURE_STATUS_LABEL[f.status]}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openTask(f)}
                        className="px-2 py-1 rounded-[7px] text-[11px] font-semibold bg-[#F2ECE3] text-[#555047] hover:bg-[#E5DFD4] transition-colors cursor-pointer"
                      >
                        Assign Task
                      </button>
                      <button
                        type="button"
                        onClick={() => openMaint(f)}
                        className="px-2 py-1 rounded-[7px] text-[11px] font-semibold bg-[#FDE8E8] text-[#A32A2A] hover:bg-[#FBDCDC] transition-colors cursor-pointer"
                      >
                        Allocate Maintenance
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Washroom Layout — schematic of REAL fixtures */}
        <div className="mb-5">
          <span className={`${sectionLabel} block mb-2`}>Washroom Layout</span>
          {groups.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[#DDD7CB] bg-[#FAF8F5] px-4 py-8 text-center">
              <p className="text-sm font-medium text-[#45413B]">
                No fixtures configured for this washroom
              </p>
              <p className="text-xs text-[#8C867C] mt-1">
                Use Edit Washroom to define the fixture inventory — the layout
                renders exactly what the database contains.
              </p>
            </div>
          ) : (
            <div className="rounded-[14px] border-2 border-[#E0D9CE] bg-[#FAF8F5]">
              <div className="px-4 py-2 border-b border-[#E0D9CE] flex items-center justify-between">
                <span className="text-[10px] tracking-[0.25em] text-[#8C867C] font-bold">
                  WASHROOM — {name.toUpperCase()}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#8C867C]">
                    Click fixtures to select · ··· for details
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedIds(new Set(fixtures.map((f) => f.fixture_uid)))
                    }
                    className="text-[10px] font-semibold text-[#386641] hover:text-[#2C5134] px-2 py-0.5 rounded-[6px] hover:bg-[#EBF3EC] transition-colors cursor-pointer"
                  >
                    Select all
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="text-[10px] font-semibold text-[#555047] hover:text-[#24221F] px-2 py-0.5 rounded-[6px] hover:bg-[#F2ECE3] transition-colors cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <div className="p-4 space-y-4">
                {groups.map((g) => {
                  const meta = fixtureMeta(g.kind, g.isCustom);
                  const Icon = meta.icon;
                  return (
                    <div key={g.kind} className="flex items-start gap-3">
                      <div className="w-20 shrink-0 pt-1 text-right">
                        <span className="block text-[10px] font-semibold text-[#8C867C] uppercase tracking-wider">
                          {meta.plural}
                        </span>
                        <span className="block text-[9px] text-[#B4AEA3]">
                          {g.fixtures.length}
                        </span>
                      </div>
                      <div
                        className="grid gap-2 flex-1"
                        style={{
                          gridTemplateColumns: `repeat(${Math.min(Math.max(g.fixtures.length, 2), 6)}, minmax(0, 1fr))`,
                        }}
                      >
                        {g.fixtures.map((f) => {
                          const isPicked = selectedIds.has(f.fixture_uid);
                          return (
                          <div
                            key={f.fixture_uid}
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleSelect(f)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleSelect(f);
                              }
                            }}
                            className={`group relative flex flex-col items-center gap-1 py-2.5 px-1 rounded-[10px] border transition-all cursor-pointer ${
                              isPicked
                                ? 'border-[#386641] bg-[#EBF3EC]/60 ring-2 ring-[#386641] ring-offset-1 ring-offset-[#FAF8F5]'
                                : f.status === 'inactive'
                                ? 'border-[#EBB3B3] bg-[#FDE8E8]/70 hover:border-[#C53B3B] hover:shadow-sm'
                                : 'border-[#E0D9CE] bg-white hover:border-[#386641] hover:shadow-sm'
                            }`}
                            title={`${f.label} — ${FIXTURE_STATUS_LABEL[f.status]} · click to ${isPicked ? 'deselect' : 'select'}`}
                          >
                            <span
                              className={`absolute top-1 left-1 w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center transition-colors ${
                                isPicked
                                  ? 'bg-[#386641] border-[#386641] text-white'
                                  : 'bg-white border-[#C9C2B4] group-hover:border-[#386641]'
                              }`}
                            >
                              {isPicked && (
                                <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none">
                                  <path d="M1.5 5.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </span>
                            <div className="absolute top-1 right-1">
                              <FixtureMenu
                                fixture={f}
                                disabled={false}
                                onAction={fixtureAction}
                              />
                            </div>
                            <Icon className="w-4 h-4 text-[#555047]" />
                            <span className="text-[10px] font-semibold text-[#24221F]">
                              {f.label}
                            </span>
                            <span
                              className={`text-[8px] font-medium ${FIXTURE_STATUS_TEXT[f.status]}`}
                            >
                              {FIXTURE_STATUS_LABEL[f.status]}
                            </span>
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${FIXTURE_STATUS_DOT[f.status]}`}
                            />
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-dashed border-[#D8D2C7] px-4 py-2 text-center">
                <span className="text-[10px] font-semibold tracking-[0.2em] text-[#8C867C]">
                  ENTRY
                </span>
              </div>
              {selectedIds.size > 0 && (
                <div className="border-t border-[#E0D9CE] bg-[#EBF3EC]/70 px-4 py-2.5 flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-[#244E2C]">
                    {`${selectedIds.size} fixture${selectedIds.size === 1 ? '' : 's'} selected`}
                  </span>
                  <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                    <button
                      type="button"
                      disabled={selectedIds.size === 0}
                      onClick={bulkTask}
                      className="px-2.5 py-1 rounded-[7px] text-[11px] font-semibold bg-[#386641] text-white hover:bg-[#2C5134] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Assign Task
                    </button>
                    <button
                      type="button"
                      disabled={selectedIds.size === 0}
                      onClick={bulkMaint}
                      className="px-2.5 py-1 rounded-[7px] text-[11px] font-semibold bg-[#FDE8E8] text-[#A32A2A] hover:bg-[#FBDCDC] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Allocate Maintenance
                    </button>
                    <button
                      type="button"
                      disabled={selectedIds.size === 0}
                      onClick={bulkTask}
                      className="px-2.5 py-1 rounded-[7px] text-[11px] font-semibold bg-white border border-[#DDD7CB] text-[#555047] hover:bg-[#F2ECE3] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Needs Cleaning
                    </button>
                    <button
                      type="button"
                      disabled={selectedIds.size === 0}
                      onClick={() => void bulkStatus('operational')}
                      className="px-2.5 py-1 rounded-[7px] text-[11px] font-semibold bg-white border border-[#DDD7CB] text-[#555047] hover:bg-[#F2ECE3] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Mark Operational
                    </button>
                    <button
                      type="button"
                      disabled={selectedIds.size === 0}
                      onClick={() => void bulkStatus('inactive')}
                      className="px-2.5 py-1 rounded-[7px] text-[11px] font-semibold bg-white border border-[#DDD7CB] text-[#555047] hover:bg-[#F2ECE3] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Inactive
                    </button>
                    {selectedIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedIds(new Set())}
                        className="px-2 py-1 rounded-[7px] text-[11px] font-medium text-[#8C867C] hover:text-[#24221F] transition-colors cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Fixture detail panel — real record fields only */}
          {liveSelected && (
            <div className="mt-3 rounded-[12px] border border-[#DDD7CB] bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#F2ECE3]">
                <div className="flex items-center gap-2.5">
                  {(() => {
                    const Icon = fixtureMeta(
                      liveSelected.fixture_type,
                      isCustomKind(liveSelected.fixture_type)
                    ).icon;
                    return <Icon className="w-4 h-4 text-[#555047]" />;
                  })()}
                  <span className="text-sm font-bold text-[#24221F]">
                    {liveSelected.label}
                  </span>
                  <Badge
                    variant={
                      liveSelected.status === 'operational'
                        ? 'sage'
                        : liveSelected.status === 'maintenance'
                        ? 'red'
                        : 'neutral'
                    }
                    size="sm"
                  >
                    {FIXTURE_STATUS_LABEL[liveSelected.status]}
                  </Badge>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedFixture(null)}
                  className="w-6 h-6 flex items-center justify-center text-[#8C867C] hover:text-[#24221F] hover:bg-[#F3EFE9] rounded-md transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 py-3 text-[11px]">
                <div>
                  <span className="block text-[#8C867C] mb-0.5">Type</span>
                  <span className="font-medium text-[#24221F]">
                    {fixtureTypeLabel(liveSelected)}
                  </span>
                </div>
                <div>
                  <span className="block text-[#8C867C] mb-0.5">Cleaning</span>
                  <span className="font-medium text-[#24221F]">
                    {liveSelected.status === 'operational' ? 'Clean' : 'Attention'}
                  </span>
                </div>
                <div>
                  <span className="block text-[#8C867C] mb-0.5">Last Cleaned</span>
                  <span className="font-medium text-[#24221F]">
                    {liveSelected.last_cleaned_at
                      ? fmtTimestamp(liveSelected.last_cleaned_at)
                      : 'Never recorded'}
                  </span>
                </div>
                <div>
                  <span className="block text-[#8C867C] mb-0.5">Last Maintenance</span>
                  <span className="font-medium text-[#24221F]">
                    {liveSelected.last_maintenance_at
                      ? fmtTimestamp(liveSelected.last_maintenance_at)
                      : 'No maintenance recorded'}
                  </span>
                </div>
              </div>
              {fixtureTickets.get(liveSelected.fixture_uid) && (
                <div className="px-4 py-2 border-t border-[#F2ECE3] text-[11px] text-[#A32A2A]">
                  Maintenance {fixtureTickets.get(liveSelected.fixture_uid)!.issue}
                  {fixtureTickets.get(liveSelected.fixture_uid)!.assigned_to_name &&
                    ` · Assigned to ${fixtureTickets.get(liveSelected.fixture_uid)!.assigned_to_name}`}
                </div>
              )}
              <div className="flex items-center gap-2 px-4 py-2.5 border-t border-[#F2ECE3] bg-[#FAF8F5]">
                <button
                  type="button"
                  onClick={() => openTask(liveSelected)}
                  className="px-2.5 py-1.5 rounded-[8px] text-[11px] font-semibold bg-[#386641] text-white hover:bg-[#2C5134] transition-colors cursor-pointer inline-flex items-center gap-1"
                >
                  <ClipboardCheck className="w-3 h-3" />
                  Assign Task
                </button>
                <button
                  type="button"
                  onClick={() => openMaint(liveSelected)}
                  className="px-2.5 py-1.5 rounded-[8px] text-[11px] font-semibold bg-[#FDE8E8] text-[#A32A2A] hover:bg-[#FBDCDC] transition-colors cursor-pointer inline-flex items-center gap-1"
                >
                  <Wrench className="w-3 h-3" />
                  Allocate Maintenance
                </button>
                {onEdit && (
                  <button
                    type="button"
                    onClick={() => onEdit(washroom)}
                    className="px-2.5 py-1.5 rounded-[8px] text-[11px] font-semibold bg-[#F2ECE3] text-[#555047] hover:bg-[#E5DFD4] transition-colors cursor-pointer inline-flex items-center gap-1"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit Fixture Inventory
                  </button>
                )}
                <span className="ml-auto text-[10px] text-[#8C867C]">
                  Condition: {FIXTURE_CONDITION[liveSelected.status]}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Recent Activity — real records only */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <History className="w-3.5 h-3.5 text-[#8C867C]" />
            <span className={sectionLabel}>Recent Activity</span>
          </div>
          {activity.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-[#DDD7CB] bg-[#FAF8F5] px-4 py-4 text-center">
              <p className="text-xs text-[#8C867C]">
                No activity recorded yet — tasks and maintenance for this
                washroom will appear here.
              </p>
            </div>
          ) : (
            <div className="rounded-[10px] border border-[#EAE5DC] divide-y divide-[#F2ECE3] overflow-hidden">
              {activity.map((a, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 bg-white">
                  {a.icon === 'maintenance' ? (
                    <Wrench className="w-3.5 h-3.5 text-[#8C867C] shrink-0" />
                  ) : (
                    <ClipboardCheck className="w-3.5 h-3.5 text-[#8C867C] shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-[#24221F] truncate">{a.text}</p>
                    {a.actor && (
                      <p className="text-[10px] text-[#8C867C]">{a.actor}</p>
                    )}
                  </div>
                  <span className="text-[10px] text-[#8C867C] shrink-0">{a.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Secondary workflows */}
      {taskOpen && (
        <AssignWashroomTaskModal
          key={taskFixture?.fixture_uid ?? 'washroom'}
          washroomName={name}
          washroomUid={washroom.washroom_uid}
          fixtures={fixtures}
          presetFixture={taskFixture}
          presetFixtures={
            selectedIds.size > 1 ? selectedFixtures : undefined
          }
          onSuccess={clearSelection}
          onClose={() => setTaskOpen(false)}
        />
      )}
      {maintOpen && (
        <ScheduleWashroomMaintenanceModal
          key={maintFixture?.fixture_uid ?? 'washroom'}
          washroomUid={washroom.washroom_uid}
          washroomName={name}
          fixtures={fixtures}
          presetFixture={maintFixture}
          presetFixtures={
            selectedIds.size > 1 ? selectedFixtures : undefined
          }
          dorm={dorm}
          zone={zone}
          onSuccess={clearSelection}
          onClose={() => setMaintOpen(false)}
        />
      )}
    </>
  );
};

import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Bath,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import { MaintenanceTicket, Washroom } from '../../types';
import { isBlockingTicket } from '../../lib/maintenanceUtils';
import { WASHROOM_TYPES } from './WashroomModal';
import {
  FIXTURE_STATUS_DOT,
  FIXTURE_STATUS_LABEL,
  buildFixtureGroups,
  fixtureMeta,
  isCustomKind,
  summarize,
} from '../../lib/washroomFixtures';
import {
  unitVisualState,
  UNIT_VISUAL_DOT,
  UNIT_VISUAL_LABEL,
  UNIT_VISUAL_TEXT,
} from '../ui/Badge';

interface WashroomsViewProps {
  zoneFilter: string;
  statusFilter: string;
  onZoneFilterChange: (zoneUid: string) => void;
  onCreate: () => void;
  onEdit: (washroom: Washroom) => void;
  onDelete: (washroom: Washroom) => void;
  onMaintenance: (washroom: Washroom, activeTicket: MaintenanceTicket | null) => void;
  onViewDetails: (washroom: Washroom) => void;
}

// Status presentation derives from the ONE canonical resolver —
// `unitVisualState` consumes the server-emitted `visual_state`; the only
// washroom-specific touch is calling the free state "Operational".
const washroomStatusPresentation = (washroom: Washroom) => {
  const visual = unitVisualState(washroom);
  return {
    label: visual === 'green' ? 'Operational' : UNIT_VISUAL_LABEL[visual],
    dot: UNIT_VISUAL_DOT[visual],
    text: UNIT_VISUAL_TEXT[visual],
  };
};

const sectionLabel =
  'text-[10px] font-semibold text-[#8C867C] uppercase tracking-wider font-body';

const isActiveTask = (status: string) =>
  !['completed', 'cancelled', 'closed'].includes(status);

type AttachmentFilter = 'all' | 'dorm' | 'common';

const ATTACHMENT_OPTIONS: {
  value: AttachmentFilter;
  label: string;
  hint: string;
}[] = [
  { value: 'all', label: 'All', hint: 'Every washroom in this property' },
  { value: 'dorm', label: 'Attached to dorms', hint: 'Owned by a specific dorm' },
  { value: 'common', label: 'Common', hint: 'Zone-level / shared washrooms' },
];

export const WashroomsView: React.FC<WashroomsViewProps> = ({
  zoneFilter,
  statusFilter,
  onZoneFilterChange,
  onCreate,
  onEdit,
  onDelete,
  onMaintenance,
  onViewDetails,
}) => {
  const {
    currentPropertyWashrooms,
    currentPropertyZones,
    currentPropertyDorms,
    currentPropertyMaintenance,
    currentPropertyTasks,
    moveWashroomToZone,
  } = useApp();
  const [attachmentFilter, setAttachmentFilter] =
    useState<AttachmentFilter>('all');

  const attachmentCounts = useMemo(() => {
    let dorm = 0;
    let common = 0;
    for (const w of currentPropertyWashrooms) {
      if (w.dorm_uid) dorm += 1;
      else common += 1;
    }
    return { all: currentPropertyWashrooms.length, dorm, common };
  }, [currentPropertyWashrooms]);

  const ticketsByWashroom = useMemo(() => {
    const map = new Map<string, MaintenanceTicket[]>();
    for (const t of currentPropertyMaintenance) {
      if (!t.washroom_uid || !isBlockingTicket(t.status)) continue;
      const list = map.get(t.washroom_uid) || [];
      list.push(t);
      map.set(t.washroom_uid, list);
    }
    return map;
  }, [currentPropertyMaintenance]);

  const openTasksByWashroom = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of currentPropertyTasks) {
      if (t.washroom_uid && isActiveTask(t.status)) {
        map.set(t.washroom_uid, (map.get(t.washroom_uid) || 0) + 1);
      }
    }
    return map;
  }, [currentPropertyTasks]);

  const filteredWashrooms = currentPropertyWashrooms.filter((washroom) => {
    if (zoneFilter !== 'all') {
      if (zoneFilter === 'unallocated' && washroom.zone_uid) return false;
      if (zoneFilter !== 'unallocated' && washroom.zone_uid !== zoneFilter) {
        return false;
      }
    }
    if (statusFilter !== 'all' && washroom.status !== statusFilter) return false;
    if (attachmentFilter === 'dorm' && !washroom.dorm_uid) return false;
    if (attachmentFilter === 'common' && washroom.dorm_uid) return false;
    return true;
  });

  if (currentPropertyWashrooms.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-[#DDD7CB] bg-[#FAF8F5] p-12 text-center">
        <div className="w-12 h-12 rounded-[12px] bg-white border border-[#D7E7F1] text-[#2D5D7B] flex items-center justify-center mx-auto mb-3">
          <Bath className="w-6 h-6" />
        </div>
        <p className="font-semibold text-sm text-[#24221F]">
          No washrooms configured
        </p>
        <p className="text-xs text-[#8C867C] mt-1 mb-4 max-w-xs mx-auto">
          Create a washroom to start managing fixtures, maintenance and tasks.
        </p>
        <Button variant="primary" size="sm" onClick={onCreate}>
          <Plus className="w-4 h-4 mr-1" />
          Create Washroom
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Compact filter toolbar — attachment type + zone */}
      <div className="flex items-center gap-x-5 gap-y-1.5 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#736E65] shrink-0">
          <SlidersHorizontal className="w-3 h-3" />
          Filters
        </span>

        <span className="inline-flex items-center gap-1 flex-wrap">
          <span className={`${sectionLabel} mr-0.5`}>Type</span>
          {ATTACHMENT_OPTIONS.map((opt) => {
            const active = attachmentFilter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAttachmentFilter(opt.value)}
                title={opt.hint}
                aria-pressed={active}
                className={`px-2 py-0.5 rounded-[8px] text-[11px] font-semibold border transition-colors cursor-pointer inline-flex items-center gap-1 focus:outline-none focus:ring-1 focus:ring-[#386641] ${
                  active
                    ? 'bg-[#386641] text-white border-[#386641]'
                    : 'bg-white text-[#555047] border-[#E3DCD0] hover:border-[#C6BEB0] hover:bg-[#FAF8F5]'
                }`}
              >
                {opt.label}
                <span
                  className={`text-[10px] font-bold ${
                    active ? 'text-white/75' : 'text-[#8C867C]'
                  }`}
                >
                  {attachmentCounts[opt.value]}
                </span>
              </button>
            );
          })}
        </span>

        <span className="inline-flex items-center gap-1 flex-wrap">
          <span className={`${sectionLabel} mr-0.5`}>Zone</span>
          {[{ zone_uid: 'all', name: 'All Zones' },
            { zone_uid: 'unallocated', name: 'Unallocated' },
            ...currentPropertyZones,
          ].map((z) => {
            const active = zoneFilter === z.zone_uid;
            return (
              <button
                key={z.zone_uid}
                type="button"
                onClick={() => onZoneFilterChange(z.zone_uid)}
                aria-pressed={active}
                className={`px-2 py-0.5 rounded-[8px] text-[11px] font-semibold border transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#2D5D7B] ${
                  active
                    ? 'bg-[#2D5D7B] text-white border-[#2D5D7B]'
                    : 'bg-white text-[#555047] border-[#E3DCD0] hover:border-[#C6BEB0] hover:bg-[#FAF8F5]'
                }`}
              >
                {z.name}
              </button>
            );
          })}
        </span>

        <span className="inline-flex items-center gap-2.5 ml-auto">
          {(attachmentFilter !== 'all' || zoneFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setAttachmentFilter('all');
                onZoneFilterChange('all');
              }}
              className="text-[11px] font-medium text-[#8C867C] hover:text-[#555047] transition-colors cursor-pointer focus:outline-none focus:underline"
            >
              Clear filters
            </button>
          )}
          <span className="text-[11px] text-[#8C867C]">
            {filteredWashrooms.length} of {currentPropertyWashrooms.length}{' '}
            shown
          </span>
        </span>
      </div>

      {filteredWashrooms.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[#DDD7CB] bg-[#FAF8F5] p-10 text-center">
          <p className="font-semibold text-sm text-[#24221F]">No washrooms found</p>
          <p className="text-xs text-[#8C867C] mt-1">
            Adjust the attachment, zone or status filters to see more.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredWashrooms.map((washroom) => {
            const zone = currentPropertyZones.find(
              (z) => z.zone_uid === washroom.zone_uid
            );
            const dorm = currentPropertyDorms.find(
              (d) => d.dorm_uid === washroom.dorm_uid
            );
            const typeLabel =
              WASHROOM_TYPES.find((t) => t.value === washroom.washroom_type)
                ?.label || washroom.washroom_type;
            const status = washroomStatusPresentation(washroom);
            const activeTickets =
              ticketsByWashroom.get(washroom.washroom_uid) || [];
            const openTasks =
              openTasksByWashroom.get(washroom.washroom_uid) || 0;
            const groups = buildFixtureGroups(washroom.fixtures || []);
            const fixtureSummary = summarize(washroom.fixtures || []);

            return (
              <div
                key={washroom.washroom_uid}
                onClick={() => onViewDetails(washroom)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onViewDetails(washroom);
                  }
                }}
                className="rounded-[14px] border border-[#EAE5DC] bg-white flex flex-col overflow-hidden transition-all duration-150 hover:border-[#C6BEB0] hover:shadow-md cursor-pointer"
                title={`${washroom.name} — view details`}
              >
                {/* Facility header */}
                <div className="px-4 pt-4 pb-3 group">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-10 h-10 rounded-[10px] bg-[#EFF6FA] border border-[#D7E7F1] text-[#2D5D7B] flex items-center justify-center shrink-0">
                        <Bath className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-display font-bold text-base text-[#24221F] truncate group-hover:text-[#386641] transition-colors">
                          {washroom.name}
                        </h3>
                        <p className="text-xs text-[#6C675F] truncate">
                          {typeLabel}
                          {dorm ? ` · ${dorm.name}` : ''}
                          {zone ? ` · ${zone.name}` : ''}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(washroom);
                      }}
                      className="text-[#999388] hover:text-[#C53B3B] p-1 rounded-[6px] transition-colors cursor-pointer shrink-0"
                      title="Delete washroom"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${status.text}`}>
                      <span className={`w-2 h-2 rounded-full ${status.dot}`} />
                      {status.label}
                    </span>
                    {activeTickets.length > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#A32A2A]">
                        <Wrench className="w-3 h-3" />
                        {activeTickets.length} active
                      </span>
                    )}
                    {openTasks > 0 && (
                      <span className="text-xs font-medium text-[#555047]">
                        {openTasks} open task{openTasks === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Facility inventory — real fixture rows */}
                <div className="px-4 py-3 border-t border-[#F2ECE3]">
                  <span className={sectionLabel}>Facilities</span>
                  {groups.length === 0 ? (
                    <p className="text-xs text-[#8C867C] mt-1.5">
                      No fixtures configured
                    </p>
                  ) : (
                    <div className="flex items-start gap-4 mt-2 flex-wrap">
                      {groups.map((g) => {
                        const meta = fixtureMeta(g.kind, g.isCustom);
                        const Icon = meta.icon;
                        return (
                          <div key={g.kind} className="text-center min-w-[36px]">
                            <div className="flex items-center justify-center gap-1.5 text-[#555047]">
                              <Icon className="w-3.5 h-3.5" />
                              <span className="text-base font-bold text-[#24221F]">
                                {String(g.fixtures.length).padStart(2, '0')}
                              </span>
                            </div>
                            <span className="block text-[10px] font-medium text-[#8C867C] mt-0.5">
                              {meta.plural}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Fixture status breakdown — real statuses */}
                {fixtureSummary.total > 0 && (
                  <div className="px-4 py-2.5 border-t border-[#F2ECE3] flex items-center gap-4 flex-wrap">
                    <span className={sectionLabel}>Facility Status</span>
                    {(['operational', 'maintenance', 'inactive'] as const).map(
                      (s) => (
                        <span
                          key={s}
                          className="inline-flex items-center gap-1.5 text-[11px] text-[#555047]"
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${FIXTURE_STATUS_DOT[s]}`}
                          />
                          {FIXTURE_STATUS_LABEL[s]}
                          <span className="font-bold text-[#24221F]">
                            {
                              {
                                operational: fixtureSummary.operational,
                                maintenance: fixtureSummary.maintenance,
                                inactive: fixtureSummary.inactive,
                              }[s]
                            }
                          </span>
                        </span>
                      )
                    )}
                  </div>
                )}

                {/* Zone / dorm metadata — compact */}
                <div className="px-4 py-2.5 border-t border-[#F2ECE3] flex items-center justify-between gap-3">
                  {dorm ? (
                    <div className="min-w-0">
                      <span className={sectionLabel}>Attached</span>
                      <p className="text-xs font-medium text-[#24221F] truncate">
                        {dorm.name}
                        {zone && (
                          <span className="text-[#8C867C] font-normal"> · {zone.name}</span>
                        )}
                      </p>
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <span className={sectionLabel}>Zone</span>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium text-[#24221F] truncate">
                          {zone?.name || 'Unallocated'}
                        </p>
                        <select
                          value={washroom.zone_uid || ''}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            moveWashroomToZone(
                              washroom.washroom_uid,
                              e.target.value || null
                            )
                          }
                          className="text-[10px] font-semibold text-[#386641] bg-transparent border border-transparent hover:border-[#DDD7CB] rounded-[6px] px-1.5 py-0.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#386641]"
                          title="Change zone"
                        >
                          <option value="">Unallocated</option>
                          {currentPropertyZones.map((z) => (
                            <option key={z.zone_uid} value={z.zone_uid}>
                              {z.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions — clicks here don't open the detail view */}
                <div
                  className="mt-auto px-4 py-3 border-t border-[#F2ECE3] bg-[#FAF8F5] flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => onViewDetails(washroom)}
                    className="flex-1 px-2.5 py-1.5 rounded-[8px] text-xs font-semibold text-[#386641] hover:bg-[#EBF3EC] transition-colors cursor-pointer inline-flex items-center justify-center gap-1"
                  >
                    View Details
                    <ArrowRight className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onMaintenance(washroom, activeTickets[0] || null)
                    }
                    className="flex-1 px-2.5 py-1.5 rounded-[8px] text-xs font-semibold text-[#A32A2A] hover:bg-[#FDE8E8] transition-colors cursor-pointer inline-flex items-center justify-center gap-1"
                  >
                    <Wrench className="w-3 h-3" />
                    {activeTickets.length > 0
                      ? `Maintenance · ${activeTickets.length} Active`
                      : 'Maintenance'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(washroom)}
                    className="px-2.5 py-1.5 rounded-[8px] text-xs font-semibold text-[#555047] hover:bg-[#F2ECE3] transition-colors cursor-pointer inline-flex items-center justify-center gap-1"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

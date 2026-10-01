import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Bed,
  Plus,
  Layers,
  Pencil,
  Trash2,
  Filter,
  Check,
  CheckCircle2,
  Clock,
  Wrench,
  Users,
  Bath,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import {
  Badge,
  RoomStatusBadge,
  BedStatusBadge,
  unitVisualState,
  UNIT_VISUAL_TINT,
} from '../ui/Badge';
import { CreateRoomModal } from './CreateRoomModal';
import { BulkCreateRoomsModal } from './BulkCreateRoomsModal';
import { EditRoomModal } from './EditRoomModal';
import { CreateDormModal } from './CreateDormModal';
import { EditDormModal } from './EditDormModal';
import { BulkCreateDormsModal } from './BulkCreateDormsModal';
import { WashroomModal } from './WashroomModal';
import { BulkCreateWashroomsModal } from './BulkCreateWashroomsModal';
import { WashroomsView } from './WashroomsView';
import { WashroomDetailModal } from './WashroomDetailModal';
import {
  fixtureCountsFor,
  fixtureMeta,
  isCustomKind,
} from '../../lib/washroomFixtures';
import { UnitZoneBoard } from './UnitZoneBoard';
import { OccupancyToggle } from './OccupancyToggle';
import { CreateMaintenanceModal, MaintenanceTarget } from '../maintenance/CreateMaintenanceModal';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import { Room, Dorm, BedStatus, RoomStatus, MaintenanceTicket, Washroom } from '../../types';
import { zoneSupportsUnits } from '../../lib/zoneUtils';
import { isBlockingTicket } from '../../lib/maintenanceUtils';

/**
 * Cleaning eligibility — occupancy is a separate axis from operational
 * work: an OCCUPIED room/bed is still cleanable. Only the operational
 * state gates cleaning (cleaning = duplicate-protection, maintenance =
 * blocked, inactive = not actionable).
 */
const isCleanable = (u: {
  operational_state?: string | null;
  status: string;
  is_occupied?: boolean;
}): boolean =>
  (u.operational_state ??
    (u.is_occupied || u.status === 'occupied' ? 'available' : u.status)) ===
  'available';

export const RoomsDormsView: React.FC = () => {
  const {
    currentPropertyRooms,
    currentPropertyDorms,
    currentPropertyWashrooms,
    currentPropertyZones,
    checkInRoom,
    checkOutRoom,
    checkInBed,
    checkOutBed,
    assignRoomToZone,
    deleteRoom,
    bulkDeleteRooms,
    bulkUpdateUnits,
    deleteDorm,
    deleteWashroom,
    updateWashroom,
    activeProperty,
    currentPropertyMaintenance,
    currentPropertyTasks,
    navigate,
    subscribeUnitDeselect,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'rooms' | 'dorms' | 'washrooms' | 'zones'>('rooms');
  const [selectedZoneFilter, setSelectedZoneFilter] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');

  // Modals
  const [singleRoomModalOpen, setSingleRoomModalOpen] = useState(false);
  const [bulkRoomModalOpen, setBulkRoomModalOpen] = useState(false);
  const [createDormModalOpen, setCreateDormModalOpen] = useState(false);
  const [bulkDormModalOpen, setBulkDormModalOpen] = useState(false);
  const [washroomModalOpen, setWashroomModalOpen] = useState(false);
  const [bulkWashroomModalOpen, setBulkWashroomModalOpen] = useState(false);
  const [editingWashroom, setEditingWashroom] = useState<Washroom | null>(null);
  const [washroomDefaults, setWashroomDefaults] = useState<
    { name?: string; zone_uid?: string; dorm_uid?: string } | undefined
  >(undefined);

  // Deletion confirm states
  const [roomToDelete, setRoomToDelete] = useState<Room | null>(null);
  const [dormToDelete, setDormToDelete] = useState<Dorm | null>(null);
  const [washroomToDelete, setWashroomToDelete] = useState<Washroom | null>(null);

  // Edit modal states
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [editingDorm, setEditingDorm] = useState<Dorm | null>(null);

  // Washroom facility detail — click the dorm-card washroom tile
  const [detailTarget, setDetailTarget] = useState<{
    washroom: Washroom | null;
    declaredName: string | null;
    dorm: Dorm | null;
    zone: (typeof currentPropertyZones)[number] | null;
  } | null>(null);

  // Maintenance ticket modal — Maint click opens the form, not a status flip
  const [maintenanceRoom, setMaintenanceRoom] = useState<Room | null>(null);
  const [maintenanceWashroom, setMaintenanceWashroom] = useState<Washroom | null>(null);
  const [maintenanceWashroomTicket, setMaintenanceWashroomTicket] =
    useState<MaintenanceTicket | null>(null);

  // Check-in is a pure occupancy toggle (unnamed occupancy allowed);
  // checkout goes through a confirmation dialog.

  // Checkout confirmation + per-unit busy lock (no double-click dupes)
  const [checkoutTarget, setCheckoutTarget] = useState<{
    kind: 'room' | 'bed';
    uid: string;
    label: string;
    guest: string | null;
  } | null>(null);
  const [busyUnits, setBusyUnits] = useState<Set<string>>(new Set());

  const runUnitAction = async (key: string, fn: () => Promise<void>) => {
    if (busyUnits.has(key)) return;
    setBusyUnits((prev) => new Set(prev).add(key));
    try {
      await fn();
    } finally {
      setBusyUnits((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const requestCheckout = (
    kind: 'room' | 'bed',
    uid: string,
    label: string,
    guest: string | null
  ) => {
    if (busyUnits.has(`${kind}:${uid}`)) return;
    setCheckoutTarget({ kind, uid, label, guest });
  };

  const confirmCheckout = () => {
    if (!checkoutTarget) return;
    const { kind, uid } = checkoutTarget;
    void runUnitAction(`${kind}:${uid}`, () =>
      kind === 'room' ? checkOutRoom(uid) : checkOutBed(uid)
    );
  };

  // Bed multi-select — batch checkout / cleaning / maintenance on picked beds
  const [selectedBeds, setSelectedBeds] = useState<Set<string>>(new Set());
  const [bedMaintenanceTargets, setBedMaintenanceTargets] =
    useState<MaintenanceTarget[] | null>(null);

  // Room multi-select — batch zone assignment / status / maintenance / delete
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set());
  const [roomMaintenanceTargets, setRoomMaintenanceTargets] =
    useState<MaintenanceTarget[] | null>(null);
  const [bulkDeleteRoomsOpen, setBulkDeleteRoomsOpen] = useState(false);

  const toggleRoomSelected = (room_uid: string) => {
    setSelectedRooms((prev) => {
      const next = new Set(prev);
      if (next.has(room_uid)) next.delete(room_uid);
      else next.add(room_uid);
      return next;
    });
  };

  const toggleBedSelected = (bed_uid: string) => {
    setSelectedBeds((prev) => {
      const next = new Set(prev);
      if (next.has(bed_uid)) next.delete(bed_uid);
      else next.add(bed_uid);
      return next;
    });
  };

  // Release container selection when its task workflow completes — the
  // event carries exact target uids, so sibling selections survive.
  useEffect(
    () =>
      subscribeUnitDeselect((target) => {
        if (target.room_uids?.length)
          setSelectedRooms((prev) => {
            const next = new Set(prev);
            for (const uid of target.room_uids!) next.delete(uid);
            return next;
          });
        if (target.bed_uids?.length)
          setSelectedBeds((prev) => {
            const next = new Set(prev);
            for (const uid of target.bed_uids!) next.delete(uid);
            return next;
          });
      }),
    [subscribeUnitDeselect]
  );

  // room_uid → active ticket map — avoids scanning all tickets per card
  const ticketsByRoom = useMemo(() => {
    const map = new Map<string, MaintenanceTicket>();
    for (const t of currentPropertyMaintenance) {
      if (t.room_uid && isBlockingTicket(t.status) && !map.has(t.room_uid)) {
        map.set(t.room_uid, t);
      }
    }
    return map;
  }, [currentPropertyMaintenance]);

  const activeTicketForRoom = (room_uid: string): MaintenanceTicket | null =>
    ticketsByRoom.get(room_uid) || null;

  // Only stay-type zones can hold rooms/dorms/beds; washrooms may use any zone.
  const stayZones = currentPropertyZones.filter((z) => zoneSupportsUnits(z));
  const filterZones = activeTab === 'washrooms' ? currentPropertyZones : stayZones;

  // Filtered Rooms
  const filteredRooms = currentPropertyRooms.filter((r) => {
    if (selectedZoneFilter !== 'all') {
      if (selectedZoneFilter === 'unallocated' && r.zone_uid !== null) return false;
      if (selectedZoneFilter !== 'unallocated' && r.zone_uid !== selectedZoneFilter) return false;
    }
    if (selectedStatusFilter !== 'all' && r.status !== selectedStatusFilter) return false;
    return true;
  });

  // Room selection helpers (filtered list is the "select all" scope)
  const selectedRoomObjs = filteredRooms.filter((r) => selectedRooms.has(r.room_uid));
  const allFilteredSelected =
    filteredRooms.length > 0 && selectedRoomObjs.length === filteredRooms.length;
  const toggleAllFilteredRooms = () =>
    setSelectedRooms((prev) => {
      const next = new Set(prev);
      filteredRooms.forEach((r) =>
        allFilteredSelected ? next.delete(r.room_uid) : next.add(r.room_uid)
      );
      return next;
    });
  const clearRoomSelection = () => setSelectedRooms(new Set());

  const assignSelectedToZone = async (zone_uid: string | null) => {
    const uids = selectedRoomObjs.map((r) => r.room_uid);
    await Promise.all(uids.map((uid) => assignRoomToZone(uid, zone_uid)));
    clearRoomSelection();
  };

  const runRoomAction = async (
    action: 'checkout' | 'cleaning' | 'available' | 'cleaned'
  ) => {
    await bulkUpdateUnits({ action, roomUids: selectedRoomObjs.map((r) => r.room_uid) });
    clearRoomSelection();
  };

  // Filtered Dorms
  const filteredDorms = currentPropertyDorms.filter((d) => {
    if (selectedZoneFilter !== 'all') {
      if (selectedZoneFilter === 'unallocated' && d.zone_uid !== null) return false;
      if (selectedZoneFilter !== 'unallocated' && d.zone_uid !== selectedZoneFilter) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Header & CTAs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display font-bold text-2xl sm:text-[28px] text-[#24221F] tracking-tight">
              Accommodations Management
            </h1>
            <Badge variant="sage" size="md">
              {activeTab === 'rooms'
                ? `${currentPropertyRooms.length} Rooms`
                : activeTab === 'dorms'
                ? `${currentPropertyDorms.length} Dorms`
                : activeTab === 'washrooms'
                ? `${currentPropertyWashrooms.length} Washrooms`
                : `${currentPropertyZones.length} Zones`}
            </Badge>
          </div>
          <p className="font-body text-sm text-[#6C675F] mt-1">
            Private suites, shared dormitories, and physical bed inventory in{' '}
            <strong className="text-[#24221F] font-semibold">{activeProperty?.name}</strong>
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {activeTab === 'zones' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateDormModalOpen(true)}
              >
                <Bed className="w-4 h-4 mr-1.5" />
                <span>Add Dorm</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingWashroom(null);
                  setWashroomDefaults(undefined);
                  setWashroomModalOpen(true);
                }}
              >
                <Bath className="w-4 h-4 mr-1.5" />
                <span>Add Washroom</span>
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setSingleRoomModalOpen(true)}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                <span>Add Room</span>
              </Button>
            </>
          ) : activeTab === 'washrooms' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkWashroomModalOpen(true)}
              >
                <span>+ Bulk Create Washrooms</span>
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setEditingWashroom(null);
                  setWashroomDefaults(undefined);
                  setWashroomModalOpen(true);
                }}
              >
                <Bath className="w-4 h-4 mr-1.5" />
                <span>Create Washroom</span>
              </Button>
            </>
          ) : activeTab === 'rooms' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkRoomModalOpen(true)}
              >
                <span>Bulk Create (Range)</span>
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setSingleRoomModalOpen(true)}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                <span>Add Single Room</span>
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkDormModalOpen(true)}
              >
                <span>+ Bulk Dorm Creation</span>
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setCreateDormModalOpen(true)}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                <span>Add New Dorm</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Segmented Control / Tabs: Rooms vs Dorms */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1 border-b border-[#EAE5DC]">
        <div className="inline-flex p-1 rounded-[12px] bg-[#EBE5DB] border border-[#DDD7CB]">
          <button
            onClick={() => setActiveTab('rooms')}
            className={`px-4 py-1.5 rounded-[9px] text-xs font-semibold transition-all cursor-pointer inline-flex items-center gap-2 ${
              activeTab === 'rooms'
                ? 'bg-white text-[#24221F] shadow-xs'
                : 'text-[#6C675F] hover:text-[#24221F]'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Private Rooms ({currentPropertyRooms.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('dorms')}
            className={`px-4 py-1.5 rounded-[9px] text-xs font-semibold transition-all cursor-pointer inline-flex items-center gap-2 ${
              activeTab === 'dorms'
                ? 'bg-white text-[#24221F] shadow-xs'
                : 'text-[#6C675F] hover:text-[#24221F]'
            }`}
          >
            <Bed className="w-3.5 h-3.5" />
            <span>Shared Dorms ({currentPropertyDorms.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('washrooms')}
            className={`px-4 py-1.5 rounded-[9px] text-xs font-semibold transition-all cursor-pointer inline-flex items-center gap-2 ${
              activeTab === 'washrooms'
                ? 'bg-white text-[#24221F] shadow-xs'
                : 'text-[#6C675F] hover:text-[#24221F]'
            }`}
          >
            <Bath className="w-3.5 h-3.5" />
            <span>Washrooms ({currentPropertyWashrooms.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('zones')}
            className={`px-4 py-1.5 rounded-[9px] text-xs font-semibold transition-all cursor-pointer inline-flex items-center gap-2 ${
              activeTab === 'zones'
                ? 'bg-white text-[#24221F] shadow-xs'
                : 'text-[#6C675F] hover:text-[#24221F]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Zones ({currentPropertyZones.length})</span>
          </button>
        </div>

        {/* Filter Controls — hidden on the visual zones board */}
        {activeTab !== 'zones' && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-[#736E65]">
            <Filter className="w-3.5 h-3.5" />
            <span>Zone:</span>
            <select
              value={selectedZoneFilter}
              onChange={(e) => setSelectedZoneFilter(e.target.value)}
              className="bg-[#FAF8F5] border border-[#DDD7CB] rounded-[8px] px-2 py-1 text-xs text-[#24221F] focus:outline-none"
            >
              <option value="all">All Zones</option>
              <option value="unallocated">Unallocated</option>
              {filterZones.map((z) => (
                <option key={z.zone_uid} value={z.zone_uid}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>

          {(activeTab === 'rooms' || activeTab === 'washrooms') && (
            <div className="flex items-center gap-1.5 text-xs text-[#736E65]">
              <span>Status:</span>
              <select
                value={selectedStatusFilter}
                onChange={(e) => setSelectedStatusFilter(e.target.value)}
                className="bg-[#FAF8F5] border border-[#DDD7CB] rounded-[8px] px-2 py-1 text-xs text-[#24221F] focus:outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="available">Available</option>
                {activeTab === 'rooms' && <option value="occupied">Occupied</option>}
                <option value="cleaning">Cleaning</option>
                <option value="maintenance">Maintenance</option>
                {activeTab === 'washrooms' && (
                  <option value="inactive">Inactive</option>
                )}
              </select>
            </div>
          )}
        </div>
        )}
      </div>

      {/* ZONES TAB CONTENT — drag & drop allocation board */}
      {activeTab === 'zones' && <UnitZoneBoard />}

      {/* WASHROOMS TAB CONTENT */}
      {activeTab === 'washrooms' && (
        <WashroomsView
          zoneFilter={selectedZoneFilter}
          statusFilter={selectedStatusFilter}
          onZoneFilterChange={setSelectedZoneFilter}
          onCreate={() => {
            setEditingWashroom(null);
            setWashroomDefaults(undefined);
            setWashroomModalOpen(true);
          }}
          onEdit={(washroom) => {
            setEditingWashroom(washroom);
            setWashroomDefaults(undefined);
            setWashroomModalOpen(true);
          }}
          onDelete={setWashroomToDelete}
          onViewDetails={(washroom) =>
            setDetailTarget({
              washroom,
              declaredName: null,
              dorm:
                currentPropertyDorms.find(
                  (d) => d.dorm_uid === washroom.dorm_uid
                ) ?? null,
              zone:
                currentPropertyZones.find(
                  (z) => z.zone_uid === washroom.zone_uid
                ) ?? null,
            })
          }
          onMaintenance={(washroom, activeTicket) => {
            setMaintenanceWashroom(washroom);
            setMaintenanceWashroomTicket(activeTicket);
          }}
        />
      )}

      {/* ROOMS TAB CONTENT */}
      {activeTab === 'rooms' && (
        <div>
          {/* Multi-select toolbar — check cards to batch-assign/status/delete */}
          {filteredRooms.length > 0 && (
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1.5 text-xs font-medium text-[#555047] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  ref={(el) => {
                    if (el) {
                      el.indeterminate =
                        selectedRoomObjs.length > 0 && !allFilteredSelected;
                    }
                  }}
                  onChange={toggleAllFilteredRooms}
                  className="accent-[#386641] w-3.5 h-3.5 cursor-pointer"
                  title={
                    allFilteredSelected
                      ? 'Deselect all rooms'
                      : 'Select all filtered rooms'
                  }
                />
                {allFilteredSelected
                  ? 'Deselect all'
                  : `Select all (${filteredRooms.length})`}
              </label>

              {selectedRoomObjs.length > 0 ? (
                <>
                  <span className="text-[#D8D2C7]">|</span>
                  <span className="text-xs font-semibold text-[#24221F]">
                    {selectedRoomObjs.length} selected
                  </span>

                  {/* Bulk zone assignment */}
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__skip__') return;
                      void assignSelectedToZone(v || null);
                    }}
                    className="bg-[#FAF8F5] border border-[#DDD7CB] rounded-[8px] px-2 py-1 text-xs text-[#24221F] focus:outline-none cursor-pointer"
                    title="Move selected rooms to a zone"
                  >
                    <option value="__skip__">Assign to zone…</option>
                    <option value="">(Unallocated)</option>
                    {stayZones.map((z) => (
                      <option key={z.zone_uid} value={z.zone_uid}>
                        {z.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => runRoomAction('cleaning')}
                    className="px-2 py-1 rounded-[7px] text-[11px] font-semibold bg-[#FEF3E8] text-[#8C3F03] hover:bg-[#FBE8D2] transition-colors cursor-pointer"
                    title="Queue selected rooms for housekeeping"
                  >
                    Send to cleaning
                  </button>
                  <button
                    type="button"
                    onClick={() => runRoomAction('available')}
                    className="px-2 py-1 rounded-[7px] text-[11px] font-semibold bg-[#EBF3EC] text-[#244E2C] hover:bg-[#DCEBDE] transition-colors cursor-pointer"
                    title="Release selected rooms to Available — closes occupancy and blocking work"
                  >
                    Available
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRoomMaintenanceTargets(
                        selectedRoomObjs.map((r) => ({ kind: 'room' as const, room: r }))
                      );
                      clearRoomSelection();
                    }}
                    className="px-2 py-1 rounded-[7px] text-[11px] font-semibold bg-[#FDE8E8] text-[#A32A2A] hover:bg-[#FBDCDC] transition-colors cursor-pointer"
                    title="Raise a maintenance ticket per selected room"
                  >
                    Maintenance
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkDeleteRoomsOpen(true)}
                    className="px-2 py-1 rounded-[7px] text-[11px] font-semibold bg-[#FDE8E8] text-[#A32A2A] hover:bg-[#FBDCDC] transition-colors cursor-pointer inline-flex items-center gap-1"
                    title="Permanently delete selected rooms"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={clearRoomSelection}
                    className="px-2 py-1 rounded-[7px] text-[11px] font-semibold text-[#8C867C] hover:text-[#24221F] transition-colors cursor-pointer"
                    title="Clear selection"
                  >
                    Clear
                  </button>
                </>
              ) : (
                <span className="text-[11px] text-[#8C867C]">
                  Click room checkboxes to select them for batch zone assignment, cleaning or deletion
                </span>
              )}
            </div>
          )}
          {filteredRooms.length === 0 ? (
            <Card className="p-12 text-center border-dashed">
              <Building2 className="w-8 h-8 text-[#A59F95] mx-auto mb-2" />
              <p className="font-semibold text-sm text-[#24221F]">No rooms match your filter</p>
              <p className="text-xs text-[#6C675F] mt-1 mb-4">
                Try switching the zone or status filter, or create new rooms.
              </p>
              <Button variant="primary" size="sm" onClick={() => setSingleRoomModalOpen(true)}>
                <Plus className="w-4 h-4 mr-1" />
                Add Room
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredRooms.map((room) => {
                const zone = currentPropertyZones.find((z) => z.zone_uid === room.zone_uid);
                const isSelected = selectedRooms.has(room.room_uid);

                return (
                  <Card
                    key={room.room_uid}
                    className={`p-4 flex flex-col justify-between hover:border-[#D0C8BB] ${
                      UNIT_VISUAL_TINT[unitVisualState(room)]
                    } ${
                      isSelected ? 'ring-2 ring-[#386641] ring-offset-1 ring-offset-white' : ''
                    }`}
                  >
                    <div>
                      {/* Top Bar: Checkbox + Room Number + Delete Button */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRoomSelected(room.room_uid)}
                            className="accent-[#386641] w-4 h-4 cursor-pointer shrink-0"
                            title={`Select room ${room.room_number}`}
                            aria-label={`Select room ${room.room_number}`}
                          />
                          <span className="font-display font-bold text-xl text-[#24221F]">
                            {room.room_number}
                          </span>
                          <span className="text-[11px] font-mono text-[#8C867C] px-1.5 py-0.5 rounded bg-[#FAF8F5] border border-[#EAE5DC]">
                            {room.room_uid}
                          </span>
                        </div>
                        <div className="flex items-center">
                          <button
                            onClick={() => setEditingRoom(room)}
                            className="text-[#999388] hover:text-[#386641] p-1 rounded-[6px] transition-colors cursor-pointer"
                            title="Edit room details"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setRoomToDelete(room)}
                            className="text-[#999388] hover:text-[#C53B3B] p-1 rounded-[6px] transition-colors cursor-pointer"
                            title="Delete room"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Type and Physical Specs */}
                      <div className="flex items-center justify-between text-xs text-[#555047] mb-3">
                        <span className="font-medium text-[#24221F]">{room.type}</span>
                        <span>{room.area_sqft} sq ft · {room.bed_count} Bed</span>
                      </div>

                      {/* Current Guest info — occupancy axis, not status */}
                      {(room.is_occupied ?? room.status === 'occupied') && (
                        <div className="mb-3 p-2 rounded-[8px] bg-[#EEF2F6] border border-[#CFDCEB] text-xs text-[#1E3A56] flex items-center justify-between">
                          <span className="font-medium">Guest: {room.current_guest || 'Active Guest'}</span>
                          <span className="text-[10px] text-[#305A82]">In-House</span>
                        </div>
                      )}

                      {/* Cleaning Note if present */}
                      {room.cleaning_note && (
                        <div className="mb-3 p-2 rounded-[8px] bg-[#FEF3E8] border border-[#FCD9BD] text-xs text-[#8C3F03]">
                          <span className="font-medium">Note:</span> {room.cleaning_note}
                        </div>
                      )}

                    </div>

                    {/* Occupancy toggle + workflow actions — commands only;
                        ResourceStateService stays the authority */}
                    <div className="pt-3 border-t border-[#F2ECE3]">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-semibold text-[#8C867C] uppercase tracking-wider font-body">
                          Operational Status
                        </span>
                        <RoomStatusBadge status={room.status} />
                      </div>

                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <OccupancyToggle
                          status={room.status}
                          isOccupied={room.is_occupied}
                          busy={busyUnits.has(`room:${room.room_uid}`)}
                          onCheckIn={() =>
                            void runUnitAction(`room:${room.room_uid}`, () =>
                              checkInRoom(room.room_uid)
                            )
                          }
                          onCheckOut={() =>
                            requestCheckout(
                              'room',
                              room.room_uid,
                              `Room ${room.room_number}`,
                              room.current_guest ?? null
                            )
                          }
                        />
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={
                              !isCleanable(room) ||
                              busyUnits.has(`room:${room.room_uid}`)
                            }
                            onClick={() =>
                              void runUnitAction(`room:${room.room_uid}`, () =>
                                bulkUpdateUnits({
                                  action: 'cleaning',
                                  roomUids: [room.room_uid],
                                })
                              )
                            }
                            className={`px-2 py-1 rounded-[7px] text-[11px] font-semibold border transition-colors focus:outline-none focus:ring-1 focus:ring-[#386641] ${
                              isCleanable(room) &&
                              !busyUnits.has(`room:${room.room_uid}`)
                                ? 'text-[#386641] border-[#CDE0CF] bg-[#F4F8F4] hover:bg-[#EBF3EC] cursor-pointer'
                                : 'text-[#C4BDB1] border-[#EDE8DD] bg-[#FAF8F5] cursor-not-allowed'
                            }`}
                            title={
                              room.status === 'cleaning'
                                ? 'Cleaning already in progress'
                                : (room.is_occupied ?? room.status === 'occupied')
                                  ? 'Queue this room for cleaning — guest stays checked in'
                                  : room.status === 'available'
                                    ? 'Queue this room for cleaning'
                                    : `Room is ${room.status} — cleaning not available`
                            }
                          >
                            Cleaning
                          </button>
                          <button
                            type="button"
                            disabled={
                              !(room.is_occupied ?? room.status === 'occupied') ||
                              busyUnits.has(`room:${room.room_uid}`)
                            }
                            onClick={() =>
                              requestCheckout(
                                'room',
                                room.room_uid,
                                `Room ${room.room_number}`,
                                room.current_guest ?? null
                              )
                            }
                            className={`px-2 py-1 rounded-[7px] text-[11px] font-semibold border transition-colors focus:outline-none focus:ring-1 focus:ring-[#9A4C07] ${
                              (room.is_occupied ?? room.status === 'occupied') &&
                              !busyUnits.has(`room:${room.room_uid}`)
                                ? 'text-[#9A4C07] border-[#F0D5B8] bg-[#FDF6EE] hover:bg-[#FBEEDA] cursor-pointer'
                                : 'text-[#C4BDB1] border-[#EDE8DD] bg-[#FAF8F5] cursor-not-allowed'
                            }`}
                            title={
                              room.is_occupied ?? room.status === 'occupied'
                                ? 'Check out the guest — room moves to cleaning'
                                : 'No active occupancy'
                            }
                          >
                            Checkout
                          </button>
                          <button
                            type="button"
                            onClick={() => setMaintenanceRoom(room)}
                            className={`px-2 py-1 rounded-[7px] text-[11px] font-semibold border transition-colors inline-flex items-center gap-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#A32A2A] ${
                              activeTicketForRoom(room.room_uid)
                                ? 'text-[#A32A2A] border-[#F0C7C7] bg-[#FDF1F1] hover:bg-[#FBE4E4]'
                                : 'text-[#555047] border-[#E3DCD0] bg-white hover:bg-[#FAF8F5]'
                            }`}
                            title={
                              activeTicketForRoom(room.room_uid)
                                ? 'Active maintenance ticket — click to view'
                                : 'Create a maintenance ticket'
                            }
                          >
                            <Wrench className="w-3 h-3" />
                            {activeTicketForRoom(room.room_uid) ? 'Maint ●' : 'Maint'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* DORMS TAB CONTENT */}
      {activeTab === 'dorms' && (
        <div>
          {filteredDorms.length === 0 ? (
            <Card className="p-12 text-center border-dashed">
              <Bed className="w-8 h-8 text-[#A59F95] mx-auto mb-2" />
              <p className="font-semibold text-sm text-[#24221F]">No dormitories found</p>
              <p className="text-xs text-[#6C675F] mt-1 mb-4">
                Add your first shared dorm with auto-generated bunk beds.
              </p>
              <Button variant="primary" size="sm" onClick={() => setCreateDormModalOpen(true)}>
                <Plus className="w-4 h-4 mr-1" />
                Add Dorm
              </Button>
            </Card>
          ) : (
            <div className="space-y-6">
              {filteredDorms.map((dorm) => {
                const zone = currentPropertyZones.find((z) => z.zone_uid === dorm.zone_uid);

                const washroomAvailable = dorm.washroom !== 'No Washroom';
                const occupiedCount = dorm.beds.filter(
                  (b) => b.is_occupied ?? b.status === 'occupied'
                ).length;
                const availableCount = dorm.beds.filter((b) => b.status === 'available').length;
                const cleaningCount = dorm.beds.filter((b) => b.status === 'cleaning').length;
                const maintenanceCount = dorm.beds.filter((b) => b.status === 'maintenance').length;

                const selectableBeds = dorm.beds.filter((b) => b.status !== 'inactive');
                const selectedInDorm = selectableBeds.filter((b) => selectedBeds.has(b.bed_uid));
                const allBedsSelected =
                  selectableBeds.length > 0 && selectedInDorm.length === selectableBeds.length;

                const toggleAllBeds = () =>
                  setSelectedBeds((prev) => {
                    if (selectableBeds.length === 0) return prev;
                    const next = new Set(prev);
                    selectableBeds.forEach((b) =>
                      allBedsSelected ? next.delete(b.bed_uid) : next.add(b.bed_uid)
                    );
                    return next;
                  });

                const runBedAction = async (action: 'checkout' | 'cleaning' | 'available') => {
                  const uids = selectedInDorm.map((b) => b.bed_uid);
                  await bulkUpdateUnits({ action, bedUids: uids });
                  setSelectedBeds((prev) => {
                    const next = new Set(prev);
                    uids.forEach((u) => next.delete(u));
                    return next;
                  });
                };

                const openBedMaintenance = () => {
                  // Whole dorm selected → ONE dorm-level ticket (flags every
                  // non-occupied bed); partial selection → a ticket per bed.
                  const targets: MaintenanceTarget[] = allBedsSelected
                    ? [{ kind: 'dorm', dorm }]
                    : selectedInDorm.map((b) => ({ kind: 'bed' as const, dorm, bed: b }));
                  setBedMaintenanceTargets(targets);
                  setSelectedBeds((prev) => {
                    const next = new Set(prev);
                    selectedInDorm.forEach((b) => next.delete(b.bed_uid));
                    return next;
                  });
                };

                // Washrooms OWNED by this specific dorm — each dorm has its
                // own independent washroom/fixture records (dorm_uid).
                const dormWashrooms = currentPropertyWashrooms.filter(
                  (w) => w.dorm_uid === dorm.dorm_uid
                );
                // Washrooms resolve through the shared canonical resolver —
                // no local status→style table.

                return (
                  <Card key={dorm.dorm_uid} className="p-5">
                    {/* Dorm Header Bar */}
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#F2ECE3]">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            type="checkbox"
                            checked={allBedsSelected}
                            disabled={selectableBeds.length === 0}
                            ref={(el) => {
                              if (el) {
                                el.indeterminate =
                                  selectedInDorm.length > 0 && !allBedsSelected;
                              }
                            }}
                            onChange={toggleAllBeds}
                            className="accent-[#386641] w-4 h-4 cursor-pointer shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                            title={
                              selectableBeds.length === 0
                                ? 'No active beds in this dorm'
                                : allBedsSelected
                                ? 'Deselect all beds'
                                : 'Select whole dorm'
                            }
                            aria-label={`Select all beds in ${dorm.name}`}
                          />
                          <h3 className="font-display font-bold text-xl text-[#24221F]">
                            {dorm.name}
                          </h3>
                          <Badge variant="lavender" size="sm">
                            {dorm.dorm_type}
                          </Badge>
                          <Badge
                            variant={washroomAvailable ? 'sage' : 'neutral'}
                            size="sm"
                          >
                            <Bath className="w-3 h-3" />
                            {washroomAvailable
                              ? 'Washroom Available'
                              : 'Washroom Not Available'}
                          </Badge>
                          {dorm.status === 'maintenance' && (
                            <Badge variant="red" size="sm">
                              Maintenance
                            </Badge>
                          )}
                          <span className="text-xs font-mono text-[#8C867C] px-1.5 py-0.5 rounded bg-[#FAF8F5] border border-[#EAE5DC]">
                            {dorm.dorm_uid}
                          </span>
                        </div>
                        <p className="text-xs text-[#6C675F] font-body mt-1">
                          {dorm.beds.length} Total Bunks · {dorm.area_sqft} sq ft · {dorm.floor || 'Floor'} · Washroom: {washroomAvailable ? dorm.washroom : 'Not Available'}
                          {dorm.description && ` · ${dorm.description}`}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => setEditingDorm(dorm)}
                          className="p-1.5 text-[#A59F95] hover:text-[#386641] hover:bg-[#EBF3EC] rounded-[8px] transition-colors cursor-pointer ml-1"
                          title="Edit dorm details"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDormToDelete(dorm)}
                          className="p-1.5 text-[#A59F95] hover:text-[#C53B3B] hover:bg-[#FDE8E8] rounded-[8px] transition-colors cursor-pointer ml-1"
                          title="Delete dorm and its beds"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Real-time Beds Stats Bar */}
                    <div className="py-3 flex items-center justify-between text-xs text-[#6C675F] font-body flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1 font-medium text-[#2E6038]">
                          <span className="w-2 h-2 rounded-full bg-[#386641]" />
                          <span>{availableCount} Available</span>
                        </span>
                        <span className="inline-flex items-center gap-1 font-medium text-[#254668]">
                          <span className="w-2 h-2 rounded-full bg-[#2563EB]" />
                          <span>{occupiedCount} Occupied</span>
                        </span>
                        <span className="inline-flex items-center gap-1 font-medium text-[#9A4C07]">
                          <span className="w-2 h-2 rounded-full bg-[#D97706]" />
                          <span>{cleaningCount} Cleaning</span>
                        </span>
                        <span className="inline-flex items-center gap-1 font-medium text-[#A32A2A]">
                          <span className="w-2 h-2 rounded-full bg-[#C53B3B]" />
                          <span>{maintenanceCount} Maintenance</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="flex items-center gap-1.5 cursor-pointer font-medium text-[#555047] select-none">
                          <input
                            type="checkbox"
                            checked={allBedsSelected}
                            disabled={selectableBeds.length === 0}
                            ref={(el) => {
                              if (el) {
                                el.indeterminate =
                                  selectedInDorm.length > 0 && !allBedsSelected;
                              }
                            }}
                            onChange={toggleAllBeds}
                            className="accent-[#386641] w-3.5 h-3.5 cursor-pointer disabled:cursor-not-allowed"
                          />
                          All beds
                        </label>
                        {selectedInDorm.length > 0 ? (
                          <>
                            <span className="text-[#D8D2C7]">|</span>
                            <span className="font-semibold text-[#24221F]">
                              {allBedsSelected
                                ? 'Whole dorm selected'
                                : `${selectedInDorm.length} selected`}
                            </span>
                            <button
                              type="button"
                              onClick={() => runBedAction('cleaning')}
                              className="px-2 py-1 rounded-[7px] text-[11px] font-semibold bg-[#FEF3E8] text-[#8C3F03] hover:bg-[#FBE8D2] transition-colors cursor-pointer"
                              title="Queue selected beds for housekeeping"
                            >
                              Send to cleaning
                            </button>
                            <button
                              type="button"
                              onClick={() => runBedAction('available')}
                              className="px-2 py-1 rounded-[7px] text-[11px] font-semibold bg-[#EBF3EC] text-[#244E2C] hover:bg-[#DCEBDE] transition-colors cursor-pointer"
                              title="Release selected beds to Available — closes blocking cleaning/maintenance work"
                            >
                              Available
                            </button>
                            <button
                              type="button"
                              onClick={openBedMaintenance}
                              className="px-2 py-1 rounded-[7px] text-[11px] font-semibold bg-[#FDE8E8] text-[#A32A2A] hover:bg-[#FBDCDC] transition-colors cursor-pointer"
                              title={
                                allBedsSelected
                                  ? 'Raise one maintenance ticket for the whole dorm'
                                  : 'Raise a maintenance ticket per selected bed'
                              }
                            >
                              Maintenance
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedBeds((prev) => {
                                  const next = new Set(prev);
                                  selectedInDorm.forEach((b) => next.delete(b.bed_uid));
                                  return next;
                                })
                              }
                              className="px-2 py-1 rounded-[7px] text-[11px] font-semibold text-[#8C867C] hover:text-[#24221F] transition-colors cursor-pointer"
                              title="Clear selection"
                            >
                              Clear
                            </button>
                          </>
                        ) : (
                          <span className="text-[11px] text-[#8C867C]">
                            Click beds to select them for batch cleaning, checkout or maintenance
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Individual Beds Visual Grid (per spec: visually distinct tiles/cards, NEVER a plain table) */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5 pt-2">
                      {/* Attached washroom facility card — click opens the
                          full facility detail window (fixtures + layout) */}
                      {washroomAvailable &&
                        (dormWashrooms.length > 0 ? (
                          dormWashrooms.map((w) => {
                            const counts = fixtureCountsFor(w);
                            const totalFixtures = (Object.values(counts) as number[]).reduce(
                              (a, b) => a + b, 0
                            );
                            const breakdown = Object.keys(counts)
                              .filter((k) => counts[k] > 0)
                              .map((k) => `${counts[k]} ${fixtureMeta(k, isCustomKind(k)).plural}`)
                              .join(' · ');
                            return (
                              <button
                                key={w.washroom_uid}
                                type="button"
                                onClick={() =>
                                  setDetailTarget({
                                    washroom: w,
                                    declaredName: null,
                                    dorm,
                                    zone: zone ?? null,
                                  })
                                }
                                className={`p-3 rounded-[12px] border text-left transition-all duration-150 cursor-pointer hover:shadow-md hover:-translate-y-0.5 hover:border-[#9DBDD4] ${
                                  UNIT_VISUAL_TINT[unitVisualState(w)]
                                }`}
                                title={`${w.name} — view facility details`}
                              >
                                <div className="flex items-center justify-between text-xs font-bold">
                                  <span className="flex items-center gap-1.5 truncate">
                                    <Bath className="w-3.5 h-3.5 shrink-0" />
                                    <span className="truncate">{w.name}</span>
                                  </span>
                                  <span className="w-2 h-2 rounded-full bg-current shrink-0" />
                                </div>
                                <span className="text-[11px] font-semibold capitalize block mt-1">
                                  {w.status.replace('_', ' ')}
                                </span>
                                <span className="text-[10px] font-bold block mt-0.5">
                                  {totalFixtures} Fixtures
                                </span>
                                <span className="text-[9px] opacity-70 block leading-tight">
                                  {breakdown}
                                </span>
                                <span className="text-[9px] font-semibold opacity-80 block mt-1">
                                  View details →
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setDetailTarget({
                                washroom: null,
                                declaredName: dorm.washroom,
                                dorm,
                                zone: zone ?? null,
                              })
                            }
                            className="p-3 rounded-[12px] border text-left bg-[#EFF6FA] border-[#CFDCEB] text-[#2D5D7B] transition-all duration-150 cursor-pointer hover:shadow-md hover:-translate-y-0.5 hover:border-[#9DBDD4]"
                            title={`${dorm.washroom} — declared facility`}
                          >
                            <div className="flex items-center justify-between text-xs font-bold">
                              <span className="flex items-center gap-1.5">
                                <Bath className="w-3.5 h-3.5 shrink-0" />
                                {dorm.washroom}
                              </span>
                              <span className="w-2 h-2 rounded-full bg-current shrink-0" />
                            </div>
                            <span className="text-[9px] opacity-70 block leading-tight mt-1">
                              Declared facility — no washroom record
                            </span>
                            <span className="text-[9px] font-semibold opacity-80 block mt-1">
                              View details →
                            </span>
                          </button>
                        ))}
                      {dorm.beds.map((bed) => {
                        const isSelected = selectedBeds.has(bed.bed_uid);
                        // canonical resolver — the server's visual_state
                        // drives the tint when present
                        const tileBg =
                          UNIT_VISUAL_TINT[unitVisualState(bed)];

                        const isBedSelectable = bed.status !== 'inactive';

                        return (
                          <div
                            key={bed.bed_uid}
                            onClick={() => {
                              if (isBedSelectable) toggleBedSelected(bed.bed_uid);
                            }}
                            className={`p-3 rounded-[12px] border ${tileBg} select-none transition-shadow ${
                              isBedSelectable ? 'cursor-pointer' : 'cursor-not-allowed opacity-75'
                            } ${
                              isSelected
                                ? 'ring-2 ring-[#386641] ring-offset-1 ring-offset-white'
                                : isBedSelectable
                                ? 'hover:shadow-xs'
                                : ''
                            }`}
                            title={
                              isBedSelectable
                                ? `${bed.bed_number}: ${bed.status} — click to ${
                                    isSelected ? 'deselect' : 'select'
                                  }`
                                : `${bed.bed_number}: inactive — not selectable`
                            }
                          >
                            <div className="flex items-center justify-between text-xs font-bold">
                              <span className="flex items-center gap-1.5">
                                <span
                                  className={`w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center shrink-0 transition-colors ${
                                    isSelected
                                      ? 'bg-[#386641] border-[#386641] text-white'
                                      : 'border-current/40 bg-white/60'
                                  }`}
                                >
                                  {isSelected && (
                                    <Check className="w-2.5 h-2.5" strokeWidth={3.5} />
                                  )}
                                </span>
                                {bed.bed_number}
                              </span>
                              <span className="w-2 h-2 rounded-full bg-current" />
                            </div>
                            <span className="text-[11px] font-semibold capitalize block mt-1">
                              {bed.is_occupied && bed.status !== 'occupied'
                                ? `occupied · ${bed.status}`
                                : bed.status}
                            </span>
                            {bed.guest_name ? (
                              <span className="text-[9px] truncate block opacity-90 mt-0.5 font-medium">
                                {bed.guest_name}
                              </span>
                            ) : (
                              <span className="text-[9px] opacity-60 block mt-0.5">Vacant</span>
                            )}

                            {/* Tile click = select; occupancy/workflows stay
                                on these explicit command actions */}
                            <div
                              className="mt-1.5 pt-1.5 border-t border-current/10 flex items-center justify-between gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <OccupancyToggle
                                status={bed.status}
                                isOccupied={bed.is_occupied}
                                compact
                                busy={busyUnits.has(`bed:${bed.bed_uid}`)}
                                onCheckIn={() =>
                                  void runUnitAction(`bed:${bed.bed_uid}`, () =>
                                    checkInBed(bed.bed_uid)
                                  )
                                }
                                onCheckOut={() =>
                                  requestCheckout(
                                    'bed',
                                    bed.bed_uid,
                                    `${dorm.name} — ${bed.bed_number}`,
                                    bed.guest_name ?? null
                                  )
                                }
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <CreateRoomModal
        isOpen={singleRoomModalOpen}
        onClose={() => setSingleRoomModalOpen(false)}
      />

      {editingRoom && (
        <EditRoomModal
          key={editingRoom.room_uid}
          isOpen
          room={editingRoom}
          onClose={() => setEditingRoom(null)}
        />
      )}

      <BulkCreateRoomsModal
        isOpen={bulkRoomModalOpen}
        onClose={() => setBulkRoomModalOpen(false)}
      />

      <CreateDormModal
        isOpen={createDormModalOpen}
        onClose={() => setCreateDormModalOpen(false)}
      />

      {editingDorm && (
        <EditDormModal
          key={editingDorm.dorm_uid}
          isOpen
          dorm={editingDorm}
          onClose={() => setEditingDorm(null)}
        />
      )}

      <BulkCreateDormsModal
        isOpen={bulkDormModalOpen}
        onClose={() => setBulkDormModalOpen(false)}
      />

      <WashroomModal
        isOpen={washroomModalOpen}
        washroom={editingWashroom}
        defaults={washroomDefaults}
        onClose={() => {
          setWashroomModalOpen(false);
          setEditingWashroom(null);
          setWashroomDefaults(undefined);
        }}
      />

      <BulkCreateWashroomsModal
        isOpen={bulkWashroomModalOpen}
        onClose={() => setBulkWashroomModalOpen(false)}
      />

      {/* Delete Room Confirmation */}
      {roomToDelete && (
        <ConfirmationDialog
          isOpen={!!roomToDelete}
          onClose={() => setRoomToDelete(null)}
          onConfirm={() => deleteRoom(roomToDelete.room_uid)}
          entityType="Room"
          entityName={roomToDelete.room_number}
          impactMessage="Deleting this room will remove it from zone rosters and property statistics."
        />
      )}

      {/* Delete Dorm Confirmation */}
      {dormToDelete && (
        <ConfirmationDialog
          isOpen={!!dormToDelete}
          onClose={() => setDormToDelete(null)}
          onConfirm={() => deleteDorm(dormToDelete.dorm_uid)}
          entityType="Dormitory"
          entityName={dormToDelete.name}
          impactMessage={`Deleting this dorm will also delete all ${dormToDelete.beds.length} bunk beds inside it.`}
        />
      )}

      {washroomToDelete && (
        <ConfirmationDialog
          isOpen={!!washroomToDelete}
          onClose={() => setWashroomToDelete(null)}
          onConfirm={() => {
            void deleteWashroom(washroomToDelete.washroom_uid);
            setWashroomToDelete(null);
          }}
          entityType="Washroom"
          entityName={washroomToDelete.name}
          impactMessage="Deleting this washroom removes it from its zone and selectors; task and maintenance history remain available."
        />
      )}

      {/* Maintenance ticket — Maint click opens the form; the ticket, not the
          button, flips the room to maintenance (created server-side) */}
      {maintenanceRoom && (
        <CreateMaintenanceModal
          targets={[{ kind: 'room', room: maintenanceRoom }]}
          activeTicket={activeTicketForRoom(maintenanceRoom.room_uid)}
          onClose={() => setMaintenanceRoom(null)}
          onViewTicket={() => {
            setMaintenanceRoom(null);
            navigate(`/property/${activeProperty?.property_uid}/maintenance`);
          }}
        />
      )}

      {maintenanceWashroom && (
        <CreateMaintenanceModal
          targets={[{ kind: 'washroom', washroom: maintenanceWashroom }]}
          activeTicket={maintenanceWashroomTicket}
          onClose={() => {
            setMaintenanceWashroom(null);
            setMaintenanceWashroomTicket(null);
          }}
          onViewTicket={() => {
            setMaintenanceWashroom(null);
            setMaintenanceWashroomTicket(null);
            navigate(`/property/${activeProperty?.property_uid}/maintenance`);
          }}
        />
      )}

      {/* Batch maintenance for selected beds — one ticket per bed */}
      {bedMaintenanceTargets && (
        <CreateMaintenanceModal
          targets={bedMaintenanceTargets}
          activeTicket={null}
          onClose={() => setBedMaintenanceTargets(null)}
          onViewTicket={() => {
            setBedMaintenanceTargets(null);
            navigate(`/property/${activeProperty?.property_uid}/maintenance`);
          }}
        />
      )}

      {/* Batch maintenance for selected rooms — one ticket per room */}
      {roomMaintenanceTargets && (
        <CreateMaintenanceModal
          targets={roomMaintenanceTargets}
          activeTicket={null}
          onClose={() => setRoomMaintenanceTargets(null)}
          onViewTicket={() => {
            setRoomMaintenanceTargets(null);
            navigate(`/property/${activeProperty?.property_uid}/maintenance`);
          }}
        />
      )}

      {/* Bulk room delete confirmation */}
      {bulkDeleteRoomsOpen && (
        <ConfirmationDialog
          isOpen={bulkDeleteRoomsOpen}
          onClose={() => setBulkDeleteRoomsOpen(false)}
          onConfirm={async () => {
            await bulkDeleteRooms(selectedRoomObjs.map((r) => r.room_uid));
            setBulkDeleteRoomsOpen(false);
            clearRoomSelection();
          }}
          entityType="Rooms"
          entityName={`${selectedRoomObjs.length} selected rooms`}
          impactMessage={`This will permanently delete ${selectedRoomObjs
            .map((r) => r.room_number)
            .join(', ')}. Occupied rooms cannot be deleted — check out their guests first.`}
        />
      )}

      {/* Check-in is a pure occupancy toggle — checkInRoom/checkInBed run
          directly from the OccupancyToggle (no modal). */}

      {/* Checkout — closes the occupancy; backend queues cleaning */}
      <ConfirmationDialog
        isOpen={!!checkoutTarget}
        onClose={() => setCheckoutTarget(null)}
        onConfirm={confirmCheckout}
        entityType={checkoutTarget?.kind === 'bed' ? 'Bed' : 'Room'}
        entityName={checkoutTarget?.label ?? ''}
        title={`Check out ${checkoutTarget?.label ?? ''}?`}
        warningTitle="This will close the active occupancy."
        impactMessage={
          checkoutTarget?.guest
            ? `${checkoutTarget.guest} will be checked out and the ${checkoutTarget.kind} will move to Cleaning — a housekeeping task is generated automatically.`
            : `The ${checkoutTarget?.kind ?? 'unit'} will move to Cleaning and a housekeeping task is generated automatically.`
        }
        promptMessage={`Are you sure you want to check out ${checkoutTarget?.label ?? 'this unit'}?`}
        confirmLabel="Check Out"
        confirmVariant="primary"
        isLoading={
          !!checkoutTarget &&
          busyUnits.has(`${checkoutTarget.kind}:${checkoutTarget.uid}`)
        }
      />

      {/* Washroom facility detail — fixtures, layout schematic, maintenance */}
      {detailTarget && (
        <WashroomDetailModal
          key={
            detailTarget.washroom?.washroom_uid ??
            `${detailTarget.dorm?.dorm_uid}:declared`
          }
          washroom={detailTarget.washroom}
          declaredName={detailTarget.declaredName}
          dorm={detailTarget.dorm}
          zone={detailTarget.zone}
          onClose={() => setDetailTarget(null)}
          onEdit={(w) => {
            setEditingWashroom(w);
            setWashroomModalOpen(true);
          }}
          onConfigure={() => {
            // Declared facility → create a DORM-OWNED washroom record —
            // independent configuration for this dorm only
            setEditingWashroom(null);
            setWashroomDefaults({
              name: `${detailTarget.dorm?.name} - Washroom`,
              dorm_uid: detailTarget.dorm?.dorm_uid,
            });
            setDetailTarget(null);
            setWashroomModalOpen(true);
          }}
        />
      )}
    </div>
  );
};

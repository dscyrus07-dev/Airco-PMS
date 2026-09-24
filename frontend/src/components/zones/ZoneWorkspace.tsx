import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Layers,
  Building2,
  Bed,
  Users,
  CheckCircle2,
  Clock,
  Plus,
  Check,
  CheckSquare,
  Square,
  Sparkles,
  LogOut,
  X,
  AlertCircle,
  Wrench,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { RoomStatusBadge, BedStatusBadge, Badge, TaskStatusBadge } from '../ui/Badge';
import { getInitials } from '../../lib/utils';
import { Zone, MaintenanceTicket } from '../../types';
import { getEffectiveTaskStatus } from '../../lib/taskUtils';
import { ZONE_TYPE_LABELS, zoneSupportsUnits } from '../../lib/zoneUtils';
import { isActiveTicket } from '../../lib/maintenanceUtils';
import { CreateMaintenanceModal, MaintenanceTarget } from '../maintenance/CreateMaintenanceModal';

interface ZoneWorkspaceProps {
  zone: Zone;
  onBack: () => void;
}

export const ZoneWorkspace: React.FC<ZoneWorkspaceProps> = ({ zone, onBack }) => {
  const {
    currentPropertyAreas,
    currentPropertyRooms,
    currentPropertyDorms,
    currentPropertyEmployees,
    currentPropertyTasks,
    navigate,
    activePropertyUid,
    checkoutDorm,
    markDormCleaning,
    bulkUpdateUnits,
    currentPropertyMaintenance,
  } = useApp();

  // Multi-Selection State for Rooms and Beds in this Zone
  const [selectedRoomUids, setSelectedRoomUids] = useState<string[]>([]);
  const [selectedBedUids, setSelectedBedUids] = useState<string[]>([]);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [maintenanceTarget, setMaintenanceTarget] = useState<MaintenanceTarget | null>(null);
  const [maintenanceTargetList, setMaintenanceTargetList] = useState<MaintenanceTarget[] | null>(null);

  // entity_uid → active ticket maps for room / dorm / bed maintenance actions
  const { ticketsByRoom, ticketsByDorm, ticketsByBed } = useMemo(() => {
    const rooms = new Map<string, MaintenanceTicket>();
    const dorms = new Map<string, MaintenanceTicket>();
    const beds = new Map<string, MaintenanceTicket>();
    for (const t of currentPropertyMaintenance) {
      if (!isActiveTicket(t.status)) continue;
      if (t.room_uid && !rooms.has(t.room_uid)) rooms.set(t.room_uid, t);
      // dorm-wide tickets (no specific bed) map to the dorm; bed tickets map to the bed
      if (t.dorm_uid && !t.bed_uid && !dorms.has(t.dorm_uid)) dorms.set(t.dorm_uid, t);
      if (t.bed_uid && !beds.has(t.bed_uid)) beds.set(t.bed_uid, t);
    }
    return { ticketsByRoom: rooms, ticketsByDorm: dorms, ticketsByBed: beds };
  }, [currentPropertyMaintenance]);

  // Section tab — which part of the zone is visible
  const [workspaceTab, setWorkspaceTab] = useState<'units' | 'staff' | 'tasks'>('units');

  // Resolve Area
  const associatedArea = currentPropertyAreas.find(
    (a) => a.area_uid === zone.area_uid || (!zone.area_uid && a.name === zone.floor)
  );

  const zoneRooms = currentPropertyRooms.filter((r) => r.zone_uid === zone.zone_uid);
  const zoneDorms = currentPropertyDorms.filter((d) => d.zone_uid === zone.zone_uid);
  const zoneEmployees = currentPropertyEmployees.filter((e) => e.zone_uid === zone.zone_uid);
  const zoneOpenTasks = currentPropertyTasks.filter(
    (t) => t.zone_uid === zone.zone_uid && getEffectiveTaskStatus(t) !== 'completed'
  );

  const supportsUnits = zoneSupportsUnits(zone);

  const allZoneBeds = zoneDorms.flatMap((d) => d.beds);
  const totalSelectedCount = selectedRoomUids.length + selectedBedUids.length;

  // Toggle selection helpers
  const toggleRoomSelection = (roomUid: string) => {
    setSelectedRoomUids((prev) =>
      prev.includes(roomUid) ? prev.filter((id) => id !== roomUid) : [...prev, roomUid]
    );
  };

  const toggleBedSelection = (bedUid: string) => {
    setSelectedBedUids((prev) =>
      prev.includes(bedUid) ? prev.filter((id) => id !== bedUid) : [...prev, bedUid]
    );
  };

  const clearSelection = () => {
    setSelectedRoomUids([]);
    setSelectedBedUids([]);
  };

  // Quick multi-selection filters
  const selectAllOccupied = () => {
    const occupiedRooms = zoneRooms.filter((r) => r.status === 'occupied').map((r) => r.room_uid);
    const occupiedBeds = allZoneBeds.filter((b) => b.status === 'occupied').map((b) => b.bed_uid);
    setSelectedRoomUids(occupiedRooms);
    setSelectedBedUids(occupiedBeds);
    setIsMultiSelectMode(true);
  };

  const selectAllCleaning = () => {
    const cleaningRooms = zoneRooms.filter((r) => r.status === 'cleaning').map((r) => r.room_uid);
    const cleaningBeds = allZoneBeds.filter((b) => b.status === 'cleaning').map((b) => b.bed_uid);
    setSelectedRoomUids(cleaningRooms);
    setSelectedBedUids(cleaningBeds);
    setIsMultiSelectMode(true);
  };

  const selectAllUnits = () => {
    setSelectedRoomUids(zoneRooms.map((r) => r.room_uid));
    setSelectedBedUids(allZoneBeds.map((b) => b.bed_uid));
    setIsMultiSelectMode(true);
  };

  // Bulk Actions Handlers
  const handleBulkCleaning = () => {
    if (totalSelectedCount === 0) return;
    bulkUpdateUnits({
      action: 'cleaning',
      roomUids: selectedRoomUids,
      bedUids: selectedBedUids,
    });
    clearSelection();
  };

  const handleBulkCheckout = () => {
    if (totalSelectedCount === 0) return;
    bulkUpdateUnits({
      action: 'checkout',
      roomUids: selectedRoomUids,
      bedUids: selectedBedUids,
    });
    clearSelection();
  };

  const handleBulkAvailable = () => {
    if (totalSelectedCount === 0) return;
    bulkUpdateUnits({
      action: 'available',
      roomUids: selectedRoomUids,
      bedUids: selectedBedUids,
    });
    clearSelection();
  };

  // Bulk maintenance opens the ticket form — one ticket per selected unit,
  // matching the Rooms view (ticket-first, never a bare status flip).
  const handleBulkMaintenance = () => {
    if (totalSelectedCount === 0) return;
    const targets: MaintenanceTarget[] = [];
    for (const room of zoneRooms) {
      if (selectedRoomUids.includes(room.room_uid)) {
        targets.push({ kind: 'room', room });
      }
    }
    for (const dorm of zoneDorms) {
      for (const bed of dorm.beds) {
        if (selectedBedUids.includes(bed.bed_uid)) {
          targets.push({ kind: 'bed', dorm, bed });
        }
      }
    }
    if (targets.length > 0) setMaintenanceTargetList(targets);
  };

  return (
    <div className="space-y-6">
      {/* Header with Back button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#EAE5DC]">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            <span>All Zones</span>
          </Button>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[#F4F0E8] text-[#555047]">
                {zone.code}
              </span>
              <h1 className="font-display font-bold text-2xl text-[#24221F] tracking-tight">
                {zone.name}
              </h1>
              <Badge variant={supportsUnits ? 'sage' : 'lavender'} size="sm">
                {ZONE_TYPE_LABELS[zone.zone_type || 'stay']}
              </Badge>
              {associatedArea && (
                <Badge variant="sage" size="sm">
                  Area: {associatedArea.name} ({associatedArea.code})
                </Badge>
              )}
            </div>
            {zone.description && (
              <p className="text-xs text-[#6C675F] font-body mt-0.5">
                {zone.description}
              </p>
            )}
          </div>
        </div>

        {/* Action jump buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/property/${activePropertyUid}/tasks`)}
          >
            <CheckSquare className="w-4 h-4 mr-1.5" />
            <span>Zone Tasks ({zoneOpenTasks.length})</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/property/${activePropertyUid}/rooms`)}
          >
            <Bed className="w-4 h-4 mr-1.5" />
            <span>Rooms & Dorms</span>
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate(`/property/${activePropertyUid}/employees`)}
          >
            <Users className="w-4 h-4 mr-1.5" />
            <span>Zone Staff Board</span>
          </Button>
        </div>
      </div>

      {/* Section navigation — only the selected section's data is shown */}
      <div className="flex items-center gap-1.5 flex-wrap p-1.5 bg-white border border-[#EAE5DC] rounded-[14px] w-fit">
        {(
          [
            { id: 'units' as const, label: 'Private Rooms & Dorms', icon: <Bed className="w-3.5 h-3.5" /> },
            { id: 'staff' as const, label: `Zone Staff Team (${zoneEmployees.length})`, icon: <Users className="w-3.5 h-3.5" /> },
            { id: 'tasks' as const, label: `Open Tasks (${zoneOpenTasks.length})`, icon: <CheckSquare className="w-3.5 h-3.5" /> },
          ]
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setWorkspaceTab(tab.id)}
            className={`px-3.5 py-2 rounded-[10px] text-xs font-medium transition-all cursor-pointer inline-flex items-center gap-1.5 ${
              workspaceTab === tab.id
                ? 'bg-[#386641] text-white shadow-xs'
                : 'text-[#555047] hover:bg-[#F2ECE3]'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── Private Rooms & Dorms section ─────────────────────────────── */}
      {workspaceTab === 'units' && (
      <div className="space-y-6">

      {/* Multi-Select Toolbar & Bulk Operations Dock — only meaningful for stay zones */}
      {supportsUnits && (
      <Card
        className={`p-4 transition-all duration-200 ${
          totalSelectedCount > 0
            ? 'bg-[#F2F8F3] border-[#386641] ring-2 ring-[#386641]/20 shadow-sm'
            : 'bg-white border-[#E8E2D7]'
        }`}
      >
        {/* Row 1: selection controls — toggle, quick picks, count hint */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => {
                if (isMultiSelectMode && totalSelectedCount > 0) {
                  clearSelection();
                }
                setIsMultiSelectMode(!isMultiSelectMode);
              }}
              className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                isMultiSelectMode
                  ? 'bg-[#386641] text-white shadow-xs'
                  : 'bg-[#FAF8F5] text-[#555047] hover:bg-[#F2ECE3] border border-[#DDD7CB]'
              }`}
            >
              {isMultiSelectMode ? (
                <CheckSquare className="w-3.5 h-3.5" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              <span>{isMultiSelectMode ? 'Multi-Select Active' : 'Enable Multi-Select'}</span>
            </button>

            <span className="text-[#C4BDB0] text-xs hidden sm:inline mx-0.5">|</span>

            <button
              type="button"
              onClick={selectAllOccupied}
              className="text-xs px-2.5 py-1 rounded-[8px] bg-[#EEF2F6] hover:bg-[#DCE6F1] text-[#1E3A56] font-medium transition-colors cursor-pointer"
            >
              Select Occupied
            </button>
            <button
              type="button"
              onClick={selectAllCleaning}
              className="text-xs px-2.5 py-1 rounded-[8px] bg-[#FEF3E8] hover:bg-[#FCE6D2] text-[#8C3F03] font-medium transition-colors cursor-pointer"
            >
              Select In Cleaning
            </button>
            <button
              type="button"
              onClick={selectAllUnits}
              className="text-xs px-2.5 py-1 rounded-[8px] bg-[#FAF8F5] hover:bg-[#F2ECE3] text-[#555047] font-medium transition-colors cursor-pointer border border-[#DDD7CB]"
            >
              Select All
            </button>
            {totalSelectedCount > 0 && (
              <button
                type="button"
                onClick={clearSelection}
                className="text-xs px-2.5 py-1 rounded-[8px] text-red-600 hover:bg-red-50 font-medium transition-colors cursor-pointer inline-flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                <span>Clear ({totalSelectedCount})</span>
              </button>
            )}
          </div>

          <span className="text-xs whitespace-nowrap">
            {totalSelectedCount > 0 ? (
              <span className="font-semibold text-[#1E4324]">
                {selectedRoomUids.length > 0 && `${selectedRoomUids.length} room${selectedRoomUids.length > 1 ? 's' : ''}`}
                {selectedRoomUids.length > 0 && selectedBedUids.length > 0 && ' & '}
                {selectedBedUids.length > 0 && `${selectedBedUids.length} bed${selectedBedUids.length > 1 ? 's' : ''}`}{' '}
                selected
              </span>
            ) : (
              <span className="text-[#8C867C]">Click rooms or beds below to select</span>
            )}
          </span>
        </div>

        {/* Row 2: bulk actions on the selected units */}
        <div className="flex items-center justify-end gap-2 flex-wrap mt-3 pt-3 border-t border-[#F2ECE3]">
          {/* Action 1: Bulk Check Out */}
          <Button
            variant="outline"
            size="sm"
            disabled={totalSelectedCount === 0}
            onClick={handleBulkCheckout}
            className={`text-xs gap-1.5 ${
              totalSelectedCount > 0
                ? 'border-[#C8681A] text-[#9A4C07] hover:bg-[#FEF3E8] bg-white'
                : 'opacity-50'
            }`}
            title="Check out guests from all selected units and flag them for cleaning"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Bulk Check Out ({totalSelectedCount})</span>
          </Button>

          {/* Action 2: Bulk Cleaning */}
          <Button
            variant="primary"
            size="sm"
            disabled={totalSelectedCount === 0}
            onClick={handleBulkCleaning}
            className={`text-xs gap-1.5 ${
              totalSelectedCount > 0
                ? 'bg-[#386641] hover:bg-[#2F5637] text-white shadow-xs'
                : 'opacity-50'
            }`}
            title="Queue all selected units for housekeeping cleaning"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Queue for Cleaning ({totalSelectedCount})</span>
          </Button>

          {/* Action 3: Mark Cleaned / Available */}
          {totalSelectedCount > 0 && (
            <Button
              variant="sage"
              size="sm"
              onClick={handleBulkAvailable}
              className="text-xs gap-1.5 bg-white border-[#386641] text-[#244E2C]"
              title="Mark all selected cleaned units as Available"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-[#386641]" />
              <span>Mark Cleaned / Ready</span>
            </Button>
          )}

          {/* Action 4: Send selected rooms/beds to maintenance */}
          <Button
            variant="outline"
            size="sm"
            disabled={totalSelectedCount === 0}
            onClick={handleBulkMaintenance}
            className={`text-xs gap-1.5 ${
              totalSelectedCount > 0
                ? 'border-[#C53B3B] text-[#A32A2A] hover:bg-[#FDF1F1] bg-white'
                : 'opacity-50'
            }`}
            title="Flag all selected units as under maintenance"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Maintenance ({totalSelectedCount})</span>
          </Button>
        </div>
      </Card>
      )}

          {!supportsUnits ? (
            <Card className="p-8 text-center border-dashed border-[#D9D3C7]">
              <div className="w-12 h-12 rounded-full bg-[#F2EFF9] text-[#554388] flex items-center justify-center mx-auto mb-3">
                <Layers className="w-6 h-6" />
              </div>
              <h3 className="font-display font-semibold text-lg text-[#24221F]">
                {ZONE_TYPE_LABELS[zone.zone_type || 'stay']} zone — no guest units
              </h3>
              <p className="font-body text-sm text-[#6C675F] max-w-md mx-auto mt-1">
                This zone type doesn't contain rooms, dorms or beds. Manage its staff on the
                Zone Staff Board and its work through the Tasks module.
              </p>
              {zone.description && (
                <p className="text-xs text-[#8C867C] font-body mt-3">{zone.description}</p>
              )}
            </Card>
          ) : (
            <>
          {/* Private Rooms in Zone */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-lg text-[#24221F] flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#2563EB]" />
                <span>Private Rooms ({zoneRooms.length})</span>
              </h3>
              {zoneRooms.length > 0 && (
                <span className="text-[11px] text-[#736E65]">
                  Click checkbox to multi-select for cleaning or checkout
                </span>
              )}
            </div>

            {zoneRooms.length === 0 ? (
              <Card className="p-6 text-center text-xs text-[#736E65] border-dashed">
                No private rooms allocated to this zone yet. Allocate rooms from the Rooms & Dorms view.
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {zoneRooms.map((room) => {
                  const isSelected = selectedRoomUids.includes(room.room_uid);

                  return (
                    <Card
                      key={room.room_uid}
                      onClick={() => {
                        if (isMultiSelectMode) {
                          toggleRoomSelection(room.room_uid);
                        }
                      }}
                      className={`p-4 transition-all relative ${
                        isSelected
                          ? 'border-[#386641] bg-[#F2F8F3] ring-2 ring-[#386641]/20 shadow-xs'
                          : 'hover:border-[#D5CFC3] bg-white'
                      } ${isMultiSelectMode ? 'cursor-pointer select-none' : ''}`}
                    >
                      {/* Top Row with Selection Checkbox & Room Number */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleRoomSelection(room.room_uid);
                            }}
                            className={`w-5 h-5 rounded-[6px] border flex items-center justify-center transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-[#386641] border-[#386641] text-white'
                                : 'bg-[#FAF8F5] border-[#DDD7CB] text-transparent hover:border-[#386641]'
                            }`}
                            title={isSelected ? 'Deselect room' : 'Select room'}
                          >
                            <Check className="w-3.5 h-3.5" strokeWidth={3} />
                          </button>

                          <span className="font-display font-bold text-lg text-[#24221F]">
                            Room {room.room_number}
                          </span>
                        </div>
                        <RoomStatusBadge status={room.status} />
                      </div>

                      <p className="text-xs font-medium text-[#4B4741]">{room.type}</p>
                      <div className="text-[11px] text-[#736E65] mt-1.5 flex items-center justify-between">
                        <span>{room.area_sqft} sq ft · {room.bed_count} Bed</span>
                        {room.current_guest ? (
                          <span className="text-[#2563EB] font-medium truncate max-w-[120px]">
                            {room.current_guest}
                          </span>
                        ) : (
                          <span className="text-[#8C867C] italic">No guest assigned</span>
                        )}
                      </div>

                      {/* Direct card-level quick actions — Check Out / Clean Room */}
                      <div className="mt-3 pt-2.5 border-t border-[#F2ECE3] flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={room.status !== 'occupied'}
                          onClick={(e) => {
                            e.stopPropagation();
                            bulkUpdateUnits({ action: 'checkout', roomUids: [room.room_uid] });
                          }}
                          className={`text-[11px] font-medium cursor-pointer ${
                            room.status === 'occupied'
                              ? 'text-[#9A4C07] hover:underline'
                              : 'text-[#C4BDB1] cursor-not-allowed'
                          }`}
                          title={
                            room.status === 'occupied'
                              ? 'Check out the current guest'
                              : 'Only occupied rooms can be checked out'
                          }
                        >
                          Check Out
                        </button>
                        <button
                          type="button"
                          disabled={room.status === 'occupied'}
                          onClick={(e) => {
                            e.stopPropagation();
                            bulkUpdateUnits({
                              action: room.status === 'cleaning' ? 'available' : 'cleaning',
                              roomUids: [room.room_uid],
                            });
                          }}
                          className={`text-[11px] font-medium cursor-pointer ${
                            room.status === 'occupied'
                              ? 'text-[#C4BDB1] cursor-not-allowed'
                              : room.status === 'cleaning'
                              ? 'text-[#1E4324] hover:underline'
                              : 'text-[#555047] hover:underline'
                          }`}
                          title={
                            room.status === 'occupied'
                              ? 'Check out the guest before cleaning'
                              : room.status === 'cleaning'
                              ? 'Mark room as cleaned and available'
                              : 'Queue this room for cleaning'
                          }
                        >
                          Clean Room
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMaintenanceTarget({ kind: 'room', room });
                          }}
                          className={`text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer ${
                            ticketsByRoom.has(room.room_uid)
                              ? 'text-[#B3372C] hover:underline'
                              : 'text-[#555047] hover:underline'
                          }`}
                          title={
                            ticketsByRoom.has(room.room_uid)
                              ? `Active ticket ${ticketsByRoom.get(room.room_uid)?.ticket_number} — click to view`
                              : 'Report a maintenance issue for this room'
                          }
                        >
                          <Wrench className="w-3 h-3" />
                          {ticketsByRoom.has(room.room_uid) ? 'Maintenance ●' : 'Maintenance'}
                        </button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* Dorms with Visual Bed Grid in Zone */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-lg text-[#24221F] flex items-center gap-2">
                <Bed className="w-4 h-4 text-[#C8681A]" />
                <span>Shared Dorms ({zoneDorms.length})</span>
              </h3>
              {allZoneBeds.length > 0 && (
                <span className="text-[11px] text-[#736E65]">
                  Click bed checkboxes to multi-select for cleaning or checkout
                </span>
              )}
            </div>

            {zoneDorms.length === 0 ? (
              <Card className="p-6 text-center text-xs text-[#736E65] border-dashed">
                No dormitories assigned to this zone yet.
              </Card>
            ) : (
              <div className="space-y-4">
                {zoneDorms.map((dorm) => {
                  const dormBedUids = dorm.beds.map((b) => b.bed_uid);
                  const selectedBedsInDorm = dormBedUids.filter((id) =>
                    selectedBedUids.includes(id)
                  );
                  const allBedsInDormSelected =
                    dorm.beds.length > 0 && selectedBedsInDorm.length === dorm.beds.length;

                  const toggleSelectAllDormBeds = () => {
                    if (allBedsInDormSelected) {
                      setSelectedBedUids((prev) =>
                        prev.filter((id) => !dormBedUids.includes(id))
                      );
                    } else {
                      setSelectedBedUids((prev) =>
                        Array.from(new Set([...prev, ...dormBedUids]))
                      );
                    }
                  };

                  return (
                    <Card key={dorm.dorm_uid} className="p-5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-[#F2ECE3]">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-display font-bold text-base text-[#24221F]">
                              {dorm.name}
                            </h4>
                            <Badge variant="lavender" size="sm">
                              {dorm.dorm_type}
                            </Badge>
                            <Badge variant="neutral" size="sm">
                              {dorm.washroom}
                            </Badge>
                            {(dorm.status === 'maintenance' || ticketsByDorm.has(dorm.dorm_uid)) && (
                              <Badge variant="red" size="sm">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#C53B3B]" />
                                Maintenance
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-[#6C675F] font-body mt-0.5">
                            {dorm.beds.length} Total Bunk Spots
                          </p>
                        </div>

                        {/* Dorm Quick Select & Direct Actions */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={toggleSelectAllDormBeds}
                            className={`text-xs px-2.5 py-1 rounded-[8px] border font-medium transition-colors cursor-pointer ${
                              allBedsInDormSelected
                                ? 'bg-[#386641] text-white border-[#386641]'
                                : 'bg-[#FAF8F5] text-[#555047] border-[#DDD7CB] hover:bg-[#F2ECE3]'
                            }`}
                          >
                            {allBedsInDormSelected ? 'Deselect All Beds' : 'Select All Beds'}
                          </button>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => checkoutDorm(dorm.dorm_uid)}
                            title="Checkout all occupied beds in this dorm"
                          >
                            Checkout Dorm
                          </Button>
                          <Button
                            variant="sage"
                            size="sm"
                            onClick={() => markDormCleaning(dorm.dorm_uid)}
                            title="Mark all cleaned beds as available"
                          >
                            Mark Cleaned
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setMaintenanceTarget({ kind: 'dorm', dorm })
                            }
                            title={
                              ticketsByDorm.has(dorm.dorm_uid)
                                ? `Active ticket ${ticketsByDorm.get(dorm.dorm_uid)?.ticket_number} — click to view`
                                : 'Send the whole dorm to maintenance'
                            }
                            className={
                              ticketsByDorm.has(dorm.dorm_uid)
                                ? 'border-[#C53B3B] text-[#A32A2A]'
                                : ''
                            }
                          >
                            <Wrench className="w-3.5 h-3.5 mr-1" />
                            {ticketsByDorm.has(dorm.dorm_uid) ? 'Maintenance ●' : 'Maintenance'}
                          </Button>
                        </div>
                      </div>

                      {/* Visual Bed Grid with Interactive Checkbox Selection */}
                      <div>
                        <div className="flex items-center justify-between mb-2.5">
                          <span className="text-[11px] font-semibold text-[#8C867C] uppercase tracking-wider block font-body">
                            Visual Bed Grid — Click a bed to select it
                          </span>
                          {selectedBedsInDorm.length > 0 && (
                            <span className="text-xs font-semibold text-[#386641]">
                              {selectedBedsInDorm.length}/{dorm.beds.length} beds selected
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          {dorm.beds.map((bed) => {
                            const isBedSelected = selectedBedUids.includes(bed.bed_uid);

                            let tileBg = 'bg-[#EBF3EC] border-[#CFE4D1] text-[#244E2C]';
                            if (bed.status === 'occupied') {
                              tileBg = 'bg-[#EEF2F6] border-[#CFDCEB] text-[#1E3A56]';
                            } else if (bed.status === 'cleaning') {
                              tileBg = 'bg-[#FEF3E8] border-[#FCD9BD] text-[#8C3F03]';
                            } else if (bed.status === 'maintenance') {
                              tileBg = 'bg-[#FDF1F1] border-[#F0C8C8] text-[#7C2323]';
                            }

                            return (
                              <div
                                key={bed.bed_uid}
                                onClick={() => toggleBedSelection(bed.bed_uid)}
                                className={`p-2.5 rounded-[12px] border ${tileBg} cursor-pointer hover:shadow-xs transition-all select-none relative ${
                                  isBedSelected
                                    ? 'ring-2 ring-[#386641] border-[#386641] shadow-xs'
                                    : ''
                                }`}
                              >
                                <div className="flex items-center justify-between text-xs font-semibold">
                                  <span>{bed.bed_number}</span>

                                  {/* Selection Checkbox */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleBedSelection(bed.bed_uid);
                                    }}
                                    className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-all cursor-pointer ${
                                      isBedSelected
                                        ? 'bg-[#386641] border-[#386641] text-white'
                                        : 'bg-white/80 border-[#DDD7CB] text-transparent hover:border-[#386641]'
                                    }`}
                                    title={isBedSelected ? 'Deselect bed' : 'Select bed'}
                                  >
                                    <Check className="w-3 h-3" strokeWidth={3} />
                                  </button>
                                </div>

                                <span className="text-[10px] font-medium capitalize block mt-1">
                                  {bed.status}
                                </span>
                                {bed.guest_name ? (
                                  <span className="text-[9px] truncate block opacity-85 mt-0.5 font-medium">
                                    {bed.guest_name}
                                  </span>
                                ) : (
                                  <span className="text-[9px] truncate block opacity-60 mt-0.5">
                                    No guest
                                  </span>
                                )}

                                {/* Explicit status actions — status never changes by clicking the tile itself */}
                                <div className="mt-1.5 pt-1.5 border-t border-current/10 flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setMaintenanceTarget({ kind: 'bed', dorm, bed });
                                    }}
                                    className={`text-[9px] font-semibold inline-flex items-center gap-0.5 hover:underline cursor-pointer ${
                                      ticketsByBed.has(bed.bed_uid) || bed.status === 'maintenance'
                                        ? 'text-[#A32A2A]'
                                        : ''
                                    }`}
                                    title={
                                      ticketsByBed.has(bed.bed_uid)
                                        ? `Active ticket ${ticketsByBed.get(bed.bed_uid)?.ticket_number}`
                                        : 'Send this bed to maintenance'
                                    }
                                  >
                                    <Wrench className="w-2.5 h-2.5" />
                                    {ticketsByBed.has(bed.bed_uid) || bed.status === 'maintenance' ? 'Maint ●' : 'Maint'}
                                  </button>
                                  {bed.status === 'occupied' ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        bulkUpdateUnits({ action: 'checkout', bedUids: [bed.bed_uid] });
                                      }}
                                      className="text-[9px] font-semibold hover:underline cursor-pointer"
                                      title="Check out this bed"
                                    >
                                      Check out
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        bulkUpdateUnits({
                                          action: bed.status === 'cleaning' ? 'available' : 'cleaning',
                                          bedUids: [bed.bed_uid],
                                        });
                                      }}
                                      className="text-[9px] font-semibold hover:underline cursor-pointer"
                                      title={
                                        bed.status === 'cleaning'
                                          ? 'Mark bed cleaned and available'
                                          : 'Queue this bed for cleaning'
                                      }
                                    >
                                      Clean
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
            </>
          )}
        </div>
      )}

      {/* ── Zone Staff Team section ──────────────────────────────────── */}
      {workspaceTab === 'staff' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-lg text-[#24221F] flex items-center gap-2">
              <Users className="w-4 h-4 text-[#386641]" />
              <span>Zone Staff Team ({zoneEmployees.length})</span>
            </h3>
          </div>

          <Card className="p-4 divide-y divide-[#F2ECE3]">
            {zoneEmployees.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-xs text-[#736E65] font-body mb-2">
                  No staff allocated to this zone yet.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/property/${activePropertyUid}/employees`)}
                  className="text-xs"
                >
                  Allocate Staff on Board
                </Button>
              </div>
            ) : (
              zoneEmployees.map((emp) => (
                <div
                  key={emp.employee_uid}
                  className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-8 h-8 rounded-full text-white flex items-center justify-center font-bold text-xs shrink-0"
                      style={{ backgroundColor: emp.avatar_color || '#386641' }}
                    >
                      {getInitials(emp.name)}
                    </div>
                    <div>
                      <h5 className="font-semibold text-xs text-[#24221F]">{emp.name}</h5>
                      <p className="text-[11px] text-[#6C675F]">{emp.job_title}</p>
                      <span className="text-[10px] font-mono text-[#8C867C]">{emp.employee_uid}</span>
                    </div>
                  </div>

                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F4F0E8] text-[#555047] font-medium">
                    {emp.department}
                  </span>
                </div>
              ))
            )}
          </Card>
        </div>
      )}

      {/* ── Open Tasks section ───────────────────────────────────────── */}
      {workspaceTab === 'tasks' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-lg text-[#24221F] flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-[#C8681A]" />
                <span>Open Tasks ({zoneOpenTasks.length})</span>
              </h3>
              {zoneOpenTasks.length > 0 && (
                <button
                  onClick={() => navigate(`/property/${activePropertyUid}/tasks`)}
                  className="text-[11px] font-medium text-[#386641] hover:underline cursor-pointer"
                >
                  View all
                </button>
              )}
            </div>

            <Card className="p-4 divide-y divide-[#F2ECE3]">
              {zoneOpenTasks.length === 0 ? (
                <p className="text-xs text-[#736E65] font-body text-center py-4">
                  No open tasks in this zone.
                </p>
              ) : (
                zoneOpenTasks.slice(0, 6).map((task) => (
                  <div key={task.task_uid} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#24221F] leading-snug truncate">
                          {task.title}
                        </p>
                        <p className="text-[10px] text-[#8C867C] font-mono mt-0.5">
                          {task.task_uid}
                          {task.assigned_to_name ? ` · ${task.assigned_to_name}` : ''}
                        </p>
                      </div>
                      <TaskStatusBadge status={getEffectiveTaskStatus(task)} />
                    </div>
                  </div>
                ))
              )}
            </Card>
          </div>
      )}

      {/* Maintenance ticket flow — same modal as the Rooms view */}
      {(maintenanceTarget || maintenanceTargetList) && (
        <CreateMaintenanceModal
          targets={maintenanceTargetList ?? [maintenanceTarget!]}
          activeTicket={
            maintenanceTargetList || !maintenanceTarget
              ? null
              : maintenanceTarget.kind === 'room'
                ? ticketsByRoom.get(maintenanceTarget.room.room_uid) || null
                : maintenanceTarget.kind === 'dorm'
                  ? ticketsByDorm.get(maintenanceTarget.dorm.dorm_uid) || null
                  : ticketsByBed.get(maintenanceTarget.bed.bed_uid) || null
          }
          onClose={() => {
            setMaintenanceTarget(null);
            setMaintenanceTargetList(null);
          }}
          onViewTicket={() => {
            clearSelection();
            navigate(`/property/${activePropertyUid}/maintenance`);
          }}
        />
      )}
    </div>
  );
};

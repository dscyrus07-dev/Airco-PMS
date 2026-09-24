import React, { useMemo, useState } from 'react';
import {
  Building2,
  Bed,
  Plus,
  Layers,
  Sparkles,
  LogOut,
  Trash2,
  Filter,
  CheckCircle2,
  Clock,
  Wrench,
  Users,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge, RoomStatusBadge, BedStatusBadge } from '../ui/Badge';
import { CreateRoomModal } from './CreateRoomModal';
import { BulkCreateRoomsModal } from './BulkCreateRoomsModal';
import { CreateDormModal } from './CreateDormModal';
import { UnitZoneBoard } from './UnitZoneBoard';
import { CreateMaintenanceModal } from '../maintenance/CreateMaintenanceModal';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import { Room, Dorm, BedStatus, RoomStatus, MaintenanceTicket } from '../../types';
import { zoneSupportsUnits } from '../../lib/zoneUtils';
import { isActiveTicket } from '../../lib/maintenanceUtils';

export const RoomsDormsView: React.FC = () => {
  const {
    currentPropertyRooms,
    currentPropertyDorms,
    currentPropertyZones,
    updateRoomStatus,
    assignRoomToZone,
    deleteRoom,
    bulkUpdateUnits,
    checkoutDorm,
    markDormCleaning,
    assignDormToZone,
    deleteDorm,
    activeProperty,
    currentPropertyMaintenance,
    navigate,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'rooms' | 'dorms' | 'zones'>('rooms');
  const [selectedZoneFilter, setSelectedZoneFilter] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');

  // Modals
  const [singleRoomModalOpen, setSingleRoomModalOpen] = useState(false);
  const [bulkRoomModalOpen, setBulkRoomModalOpen] = useState(false);
  const [createDormModalOpen, setCreateDormModalOpen] = useState(false);

  // Deletion confirm states
  const [roomToDelete, setRoomToDelete] = useState<Room | null>(null);
  const [dormToDelete, setDormToDelete] = useState<Dorm | null>(null);

  // Maintenance ticket modal — Maint click opens the form, not a status flip
  const [maintenanceRoom, setMaintenanceRoom] = useState<Room | null>(null);

  // room_uid → active ticket map — avoids scanning all tickets per card
  const ticketsByRoom = useMemo(() => {
    const map = new Map<string, MaintenanceTicket>();
    for (const t of currentPropertyMaintenance) {
      if (t.room_uid && isActiveTicket(t.status) && !map.has(t.room_uid)) {
        map.set(t.room_uid, t);
      }
    }
    return map;
  }, [currentPropertyMaintenance]);

  const activeTicketForRoom = (room_uid: string): MaintenanceTicket | null =>
    ticketsByRoom.get(room_uid) || null;

  // Only stay-type zones can hold rooms/dorms/beds
  const stayZones = currentPropertyZones.filter((z) => zoneSupportsUnits(z));

  // Filtered Rooms
  const filteredRooms = currentPropertyRooms.filter((r) => {
    if (selectedZoneFilter !== 'all') {
      if (selectedZoneFilter === 'unallocated' && r.zone_uid !== null) return false;
      if (selectedZoneFilter !== 'unallocated' && r.zone_uid !== selectedZoneFilter) return false;
    }
    if (selectedStatusFilter !== 'all' && r.status !== selectedStatusFilter) return false;
    return true;
  });

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
                : `${stayZones.length} Zones`}
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
                variant="primary"
                size="sm"
                onClick={() => setSingleRoomModalOpen(true)}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                <span>Add Room</span>
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
            <Button
              variant="primary"
              size="sm"
              onClick={() => setCreateDormModalOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              <span>Add New Dorm</span>
            </Button>
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
            onClick={() => setActiveTab('zones')}
            className={`px-4 py-1.5 rounded-[9px] text-xs font-semibold transition-all cursor-pointer inline-flex items-center gap-2 ${
              activeTab === 'zones'
                ? 'bg-white text-[#24221F] shadow-xs'
                : 'text-[#6C675F] hover:text-[#24221F]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Zones ({stayZones.length})</span>
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
              {stayZones.map((z) => (
                <option key={z.zone_uid} value={z.zone_uid}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>

          {activeTab === 'rooms' && (
            <div className="flex items-center gap-1.5 text-xs text-[#736E65]">
              <span>Status:</span>
              <select
                value={selectedStatusFilter}
                onChange={(e) => setSelectedStatusFilter(e.target.value)}
                className="bg-[#FAF8F5] border border-[#DDD7CB] rounded-[8px] px-2 py-1 text-xs text-[#24221F] focus:outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="available">Available</option>
                <option value="occupied">Occupied</option>
                <option value="cleaning">Cleaning</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
          )}
        </div>
        )}
      </div>

      {/* ZONES TAB CONTENT — drag & drop allocation board */}
      {activeTab === 'zones' && <UnitZoneBoard />}

      {/* ROOMS TAB CONTENT */}
      {activeTab === 'rooms' && (
        <div>
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

                return (
                  <Card key={room.room_uid} className="p-4 flex flex-col justify-between hover:border-[#D0C8BB]">
                    <div>
                      {/* Top Bar: Room Number + Delete Button */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-display font-bold text-xl text-[#24221F]">
                            Room {room.room_number}
                          </span>
                          <span className="text-[11px] font-mono text-[#8C867C] px-1.5 py-0.5 rounded bg-[#FAF8F5] border border-[#EAE5DC]">
                            {room.room_uid}
                          </span>
                        </div>
                        <button
                          onClick={() => setRoomToDelete(room)}
                          className="text-[#999388] hover:text-[#C53B3B] p-1 rounded-[6px] transition-colors cursor-pointer"
                          title="Delete room"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Type and Physical Specs */}
                      <div className="flex items-center justify-between text-xs text-[#555047] mb-3">
                        <span className="font-medium text-[#24221F]">{room.type}</span>
                        <span>{room.area_sqft} sq ft · {room.bed_count} Bed</span>
                      </div>

                      {/* Current Guest info if occupied */}
                      {room.status === 'occupied' && (
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

                      {/* Zone Assignment Dropdown on Card */}
                      <div className="mb-3">
                        <label className="block text-[10px] font-semibold text-[#8C867C] uppercase tracking-wider mb-1 font-body">
                          Physical Zone Allocation
                        </label>
                        <select
                          value={room.zone_uid || ''}
                          onChange={(e) => assignRoomToZone(room.room_uid, e.target.value || null)}
                          className="w-full bg-[#FAF8F5] border border-[#DDD7CB] rounded-[8px] px-2.5 py-1.5 text-xs text-[#24221F] focus:outline-none focus:ring-1 focus:ring-[#386641]"
                        >
                          <option value="">(Unallocated)</option>
                          {stayZones.map((z) => (
                            <option key={z.zone_uid} value={z.zone_uid}>
                              {z.name} ({z.floor})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Quick Status Changer on Card (per spec: available / occupied / cleaning / maintenance) */}
                    <div className="pt-3 border-t border-[#F2ECE3]">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-semibold text-[#8C867C] uppercase tracking-wider font-body">
                          Operational Status
                        </span>
                        <RoomStatusBadge status={room.status} />
                      </div>

                      <div className="grid grid-cols-4 gap-1">
                        <button
                          type="button"
                          onClick={() => updateRoomStatus(room.room_uid, 'available')}
                          className={`py-1 rounded-[6px] text-[10px] font-semibold transition-all cursor-pointer text-center ${
                            room.status === 'available'
                              ? 'bg-[#386641] text-white shadow-xs'
                              : 'bg-[#F2ECE3] text-[#555047] hover:bg-[#E5DFD4]'
                          }`}
                        >
                          Avail
                        </button>
                        <button
                          type="button"
                          onClick={() => updateRoomStatus(room.room_uid, 'occupied')}
                          className={`py-1 rounded-[6px] text-[10px] font-semibold transition-all cursor-pointer text-center ${
                            room.status === 'occupied'
                              ? 'bg-[#2563EB] text-white shadow-xs'
                              : 'bg-[#F2ECE3] text-[#555047] hover:bg-[#E5DFD4]'
                          }`}
                        >
                          Occ
                        </button>
                        <button
                          type="button"
                          onClick={() => updateRoomStatus(room.room_uid, 'cleaning')}
                          className={`py-1 rounded-[6px] text-[10px] font-semibold transition-all cursor-pointer text-center ${
                            room.status === 'cleaning'
                              ? 'bg-[#D97706] text-white shadow-xs'
                              : 'bg-[#F2ECE3] text-[#555047] hover:bg-[#E5DFD4]'
                          }`}
                        >
                          Clean
                        </button>
                        <button
                          type="button"
                          onClick={() => setMaintenanceRoom(room)}
                          title={
                            activeTicketForRoom(room.room_uid)
                              ? 'Active maintenance ticket — click to view'
                              : 'Create a maintenance ticket'
                          }
                          className={`py-1 rounded-[6px] text-[10px] font-semibold transition-all cursor-pointer text-center ${
                            room.status === 'maintenance'
                              ? 'bg-[#C53B3B] text-white shadow-xs'
                              : 'bg-[#F2ECE3] text-[#555047] hover:bg-[#E5DFD4]'
                          }`}
                        >
                          {activeTicketForRoom(room.room_uid) ? 'Maint ●' : 'Maint'}
                        </button>
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

                const occupiedCount = dorm.beds.filter((b) => b.status === 'occupied').length;
                const availableCount = dorm.beds.filter((b) => b.status === 'available').length;
                const cleaningCount = dorm.beds.filter((b) => b.status === 'cleaning').length;

                return (
                  <Card key={dorm.dorm_uid} className="p-5">
                    {/* Dorm Header Bar */}
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#F2ECE3]">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-display font-bold text-xl text-[#24221F]">
                            {dorm.name}
                          </h3>
                          <Badge variant="lavender" size="sm">
                            {dorm.dorm_type}
                          </Badge>
                          <Badge variant="neutral" size="sm">
                            {dorm.washroom}
                          </Badge>
                          <span className="text-xs font-mono text-[#8C867C] px-1.5 py-0.5 rounded bg-[#FAF8F5] border border-[#EAE5DC]">
                            {dorm.dorm_uid}
                          </span>
                        </div>
                        <p className="text-xs text-[#6C675F] font-body mt-1">
                          {dorm.beds.length} Total Bunks · {dorm.area_sqft} sq ft · {dorm.floor || 'Floor'}
                          {dorm.description && ` · ${dorm.description}`}
                        </p>
                      </div>

                      {/* Direct 1-Click Operational Actions: Checkout All & Mark Cleaned */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => checkoutDorm(dorm.dorm_uid)}
                          title="Checkout all currently occupied beds and tag them for cleaning"
                        >
                          <LogOut className="w-3.5 h-3.5 mr-1 text-[#2563EB]" />
                          <span>Checkout All</span>
                        </Button>

                        <Button
                          variant="sage"
                          size="sm"
                          onClick={() => markDormCleaning(dorm.dorm_uid)}
                          title="Mark all cleaning beds as fresh and ready"
                        >
                          <Sparkles className="w-3.5 h-3.5 mr-1" />
                          <span>Mark Cleaned</span>
                        </Button>

                        {/* Zone Move Dropdown */}
                        <div className="flex items-center gap-1.5 pl-2 border-l border-[#EAE5DC]">
                          <span className="text-xs text-[#736E65]">Zone:</span>
                          <select
                            value={dorm.zone_uid || ''}
                            onChange={(e) => assignDormToZone(dorm.dorm_uid, e.target.value || null)}
                            className="bg-[#FAF8F5] border border-[#DDD7CB] rounded-[8px] px-2 py-1 text-xs text-[#24221F] focus:outline-none"
                          >
                            <option value="">(Unallocated)</option>
                            {stayZones.map((z) => (
                              <option key={z.zone_uid} value={z.zone_uid}>
                                {z.name}
                              </option>
                            ))}
                          </select>
                        </div>

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
                      </div>
                      <span className="text-[11px] text-[#8C867C]">
                        Use each bed's Clean / Check out action to change its status
                      </span>
                    </div>

                    {/* Individual Beds Visual Grid (per spec: visually distinct tiles/cards, NEVER a plain table) */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5 pt-2">
                      {dorm.beds.map((bed) => {
                        let tileBg = 'bg-[#EBF3EC] border-[#CFE4D1] text-[#244E2C]';
                        if (bed.status === 'occupied') {
                          tileBg = 'bg-[#EEF2F6] border-[#CFDCEB] text-[#1E3A56]';
                        } else if (bed.status === 'cleaning') {
                          tileBg = 'bg-[#FEF3E8] border-[#FCD9BD] text-[#8C3F03]';
                        }

                        return (
                          <div
                            key={bed.bed_uid}
                            className={`p-3 rounded-[12px] border ${tileBg} select-none`}
                            title={`Bed ${bed.bed_number}: ${bed.status}`}
                          >
                            <div className="flex items-center justify-between text-xs font-bold">
                              <span>{bed.bed_number}</span>
                              <span className="w-2 h-2 rounded-full bg-current" />
                            </div>
                            <span className="text-[11px] font-semibold capitalize block mt-1">
                              {bed.status}
                            </span>
                            {bed.guest_name ? (
                              <span className="text-[9px] truncate block opacity-90 mt-0.5 font-medium">
                                {bed.guest_name}
                              </span>
                            ) : (
                              <span className="text-[9px] opacity-60 block mt-0.5">Vacant</span>
                            )}

                            {/* Explicit status actions only — clicking the tile itself does nothing */}
                            <div className="mt-1.5 pt-1.5 border-t border-current/10 flex items-center justify-end">
                              {bed.status === 'occupied' ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    bulkUpdateUnits({ action: 'checkout', bedUids: [bed.bed_uid] })
                                  }
                                  className="text-[9px] font-semibold hover:underline cursor-pointer"
                                  title="Check out this bed"
                                >
                                  Check out
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    bulkUpdateUnits({
                                      action: bed.status === 'cleaning' ? 'available' : 'cleaning',
                                      bedUids: [bed.bed_uid],
                                    })
                                  }
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

      <BulkCreateRoomsModal
        isOpen={bulkRoomModalOpen}
        onClose={() => setBulkRoomModalOpen(false)}
      />

      <CreateDormModal
        isOpen={createDormModalOpen}
        onClose={() => setCreateDormModalOpen(false)}
      />

      {/* Delete Room Confirmation */}
      {roomToDelete && (
        <ConfirmationDialog
          isOpen={!!roomToDelete}
          onClose={() => setRoomToDelete(null)}
          onConfirm={() => deleteRoom(roomToDelete.room_uid)}
          entityType="Room"
          entityName={`Room ${roomToDelete.room_number}`}
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
    </div>
  );
};

import React, { useState } from 'react';
import {
  DndContext,
  useDraggable,
  useDroppable,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  Layers,
  Building2,
  Bed,
  GripVertical,
  MapPinOff,
  CheckCircle2,
  Bath,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Room, Dorm, Washroom, Zone } from '../../types';
import { RoomStatusBadge, Badge } from '../ui/Badge';
import { zoneSupportsUnits, ZONE_TYPE_LABELS } from '../../lib/zoneUtils';

type DragItem = {
  kind: 'room' | 'dorm' | 'washroom';
  item: Room | Dorm | Washroom;
};

// ---------------------------------------------------------------------------
// Draggable unit cards (room or dorm)
// ---------------------------------------------------------------------------

const DraggableUnitCard: React.FC<{
  kind: DragItem['kind'];
  item: DragItem['item'];
  isOverlay?: boolean;
}> = ({ kind, item, isOverlay = false }) => {
  const itemUid =
    kind === 'room'
      ? (item as Room).room_uid
      : kind === 'dorm'
      ? (item as Dorm).dorm_uid
      : (item as Washroom).washroom_uid;
  const dragId = `${kind}-${itemUid}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { kind, item } satisfies DragItem | unknown,
  });

  const style = isDragging && !isOverlay ? { opacity: 0.35 } : undefined;

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      style={style}
      {...(isOverlay ? {} : listeners)}
      {...(isOverlay ? {} : attributes)}
      className={`bg-white rounded-[12px] p-3 border border-[#E5E0D6] shadow-[0_2px_8px_rgba(0,0,0,0.02)] hover:border-[#386641]/50 hover:shadow-sm transition-all select-none touch-none ${
        isOverlay
          ? 'shadow-xl rotate-1 scale-105 cursor-grabbing ring-2 ring-[#386641]'
          : 'cursor-grab active:cursor-grabbing'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-7 h-7 rounded-[8px] flex items-center justify-center shrink-0 ${
              kind === 'room'
                ? 'bg-[#EBF3EC] text-[#386641]'
                : kind === 'dorm'
                ? 'bg-[#F2EFF9] text-[#554388]'
                : 'bg-[#EFF6FA] text-[#2D5D7B]'
            }`}
          >
            {kind === 'room' ? (
              <Building2 className="w-3.5 h-3.5" />
            ) : kind === 'dorm' ? (
              <Bed className="w-3.5 h-3.5" />
            ) : (
              <Bath className="w-3.5 h-3.5" />
            )}
          </div>
          <div className="min-w-0">
            <h4 className="font-semibold text-xs text-[#24221F] leading-tight truncate">
              {kind === 'room'
                ? (item as Room).room_number
                : kind === 'dorm'
                ? (item as Dorm).name
                : (item as Washroom).name}
            </h4>
            <p className="text-[11px] text-[#6C675F] font-body truncate">
              {kind === 'room'
                ? (item as Room).type
                : kind === 'dorm'
                ? `${(item as Dorm).beds.length} beds · ${(item as Dorm).dorm_type}`
                : `${(item as Washroom).washroom_type} · ${
                    (item as Washroom).stall_count
                  } stalls · ${(item as Washroom).urinal_count} urinals · ${
                    (item as Washroom).shower_count
                  } showers`}
            </p>
          </div>
        </div>

        <GripVertical className="w-3.5 h-3.5 text-[#8C867C] shrink-0" />
      </div>

      <div className="flex items-center justify-between pt-2 mt-2 border-t border-[#F5F2EC]">
        <span className="text-[9px] uppercase tracking-wider font-semibold text-[#8C867C]">
          {kind === 'room'
            ? 'Private Room'
            : kind === 'dorm'
            ? 'Shared Dorm'
            : 'Washroom'}
        </span>
        {kind === 'room' ? (
          <RoomStatusBadge status={(item as Room).status} />
        ) : kind === 'washroom' ? (
          <span className="text-[10px] capitalize text-[#6C675F]">
            {(item as Washroom).status.replace('_', ' ')}
          </span>
        ) : null}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Droppable zone column
// ---------------------------------------------------------------------------

const DroppableZoneColumn: React.FC<{
  id: string;
  title: string;
  subtitle?: string;
  isUnallocated?: boolean;
  zone?: Zone;
  units: DragItem[];
}> = ({ id, title, subtitle, isUnallocated = false, zone, units }) => {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { zoneId: isUnallocated ? null : id },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-[16px] p-3.5 min-w-[270px] max-w-[320px] w-full shrink-0 border transition-all ${
        isOver
          ? 'bg-[#EBF3EC] border-[#386641] ring-2 ring-[#386641]/20'
          : isUnallocated
          ? 'bg-[#FAF7F2] border-[#E8E2D7]'
          : 'bg-[#F6F3EE] border-[#E5DFD4]'
      }`}
    >
      {/* Column header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2 min-w-0">
          {isUnallocated ? (
            <MapPinOff className="w-4 h-4 text-[#C8681A] shrink-0" />
          ) : (
            <Layers className="w-4 h-4 text-[#386641] shrink-0" />
          )}
          <div className="min-w-0">
            <h3 className="font-display font-bold text-sm text-[#24221F] truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="text-[10px] text-[#736E65] truncate">{subtitle}</p>
            )}
          </div>
        </div>
        <span
          className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full shrink-0 ${
            isUnallocated && units.length > 0
              ? 'bg-[#FCE8D5] text-[#A85808]'
              : 'bg-white text-[#524E47] border border-[#DDD7CB]'
          }`}
        >
          {units.length}
        </span>
      </div>

      {zone && (
        <div className="px-1 pb-2 -mt-1">
          <Badge variant="sage" size="sm">
            {ZONE_TYPE_LABELS[zone.zone_type || 'stay']}
          </Badge>
        </div>
      )}

      {/* Cards */}
      <div className="flex-1 space-y-2.5 min-h-[160px] overflow-y-auto max-h-[calc(100vh-280px)] pr-0.5">
        {units.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 border-2 border-dashed border-[#DDD7CB] rounded-[12px] text-center text-xs text-[#8C867C]">
            <p className="font-medium">
              {isUnallocated ? 'Everything is allocated' : 'No units in this zone'}
            </p>
            <p className="text-[11px] mt-0.5 opacity-80">
              Drag a room, dorm, or washroom here
            </p>
          </div>
        ) : (
          units.map((u) => (
            <DraggableUnitCard
              key={`${u.kind}-${
                u.kind === 'room'
                  ? (u.item as Room).room_uid
                  : u.kind === 'dorm'
                  ? (u.item as Dorm).dorm_uid
                  : (u.item as Washroom).washroom_uid
              }`}
              kind={u.kind}
              item={u.item}
            />
          ))
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export const UnitZoneBoard: React.FC = () => {
  const {
    currentPropertyZones,
    currentPropertyRooms,
    currentPropertyDorms,
    currentPropertyWashrooms,
    assignRoomToZone,
    assignDormToZone,
    moveWashroomToZone,
    addToast,
  } = useApp();

  const [activeDrag, setActiveDrag] = useState<DragItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const allocationZones = currentPropertyZones;

  const allUnits: DragItem[] = [
    ...currentPropertyRooms.map((r): DragItem => ({ kind: 'room', item: r })),
    ...currentPropertyDorms.map((d): DragItem => ({ kind: 'dorm', item: d })),
    ...currentPropertyWashrooms.map(
      (w): DragItem => ({ kind: 'washroom', item: w })
    ),
  ];

  const unitsForZone = (zoneUid: string | null) =>
    allUnits.filter((u) => (u.item.zone_uid ?? null) === zoneUid);

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragItem | undefined;
    if (data?.item) setActiveDrag(data);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDrag(null);
    if (!over) return;

    const data = active.data.current as DragItem | undefined;
    if (!data) return;

    const targetZoneUid = over.id === 'unallocated' ? null : (over.id as string);
    const currentZone = data.item.zone_uid ?? null;
    if (currentZone === targetZoneUid) return;

    const targetZone = targetZoneUid
      ? currentPropertyZones.find((z) => z.zone_uid === targetZoneUid)
      : null;
    if (
      targetZone &&
      !zoneSupportsUnits(targetZone) &&
      data.kind !== 'washroom'
    ) {
      addToast({
        type: 'warning',
        title: 'Stay Zone Required',
        description: 'Only washrooms can be assigned to non-stay zones.',
      });
      return;
    }

    if (data.kind === 'room') {
      assignRoomToZone((data.item as Room).room_uid, targetZoneUid);
    } else if (data.kind === 'dorm') {
      assignDormToZone((data.item as Dorm).dorm_uid, targetZoneUid);
    } else {
      moveWashroomToZone((data.item as Washroom).washroom_uid, targetZoneUid);
    }
  };

  const unallocatedCount = unitsForZone(null).length;

  return (
    <div className="space-y-4">
      {/* Helper */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-[12px] bg-[#FAF8F5] border border-[#EAE5DC] text-xs text-[#6C675F]">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#386641]" />
          <span>
            <strong>Zone Allocation Board:</strong> drag rooms, dorms, and
            washrooms into a zone column — or drop them into <strong>Unallocated</strong>.
          </span>
        </div>
        <span className="text-[11px] text-[#8C867C]">
          Changes persist immediately to the property structure.
        </span>
      </div>

      {allocationZones.length === 0 && unallocatedCount === 0 ? (
        <div className="p-12 text-center border-2 border-dashed border-[#DDD7CB] rounded-[16px] text-sm text-[#8C867C]">
          No units or zones yet. Create rooms, dorms, or washrooms, then assign them to zones.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto pb-6 pt-1">
            {/* Unallocated pool */}
            <DroppableZoneColumn
              id="unallocated"
              title="Unallocated"
              subtitle="Not assigned to any zone"
              isUnallocated
              units={unitsForZone(null)}
            />

            {/* One column per property zone */}
            {allocationZones.map((zone) => (
              <DroppableZoneColumn
                key={zone.zone_uid}
                id={zone.zone_uid}
                title={zone.name}
                subtitle={zone.code}
                zone={zone}
                units={unitsForZone(zone.zone_uid)}
              />
            ))}
          </div>

          <DragOverlay>
            {activeDrag ? (
              <DraggableUnitCard
                kind={activeDrag.kind}
                item={activeDrag.item}
                isOverlay
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
};

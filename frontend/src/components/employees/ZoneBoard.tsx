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
  UserX,
  CheckSquare,
  GripVertical,
  MapPin,
  Plus,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Employee, Zone } from '../../types';
import { getInitials } from '../../lib/utils';

interface ZoneBoardProps {
  onOpenCreateModal: () => void;
}

// ---------------------------------------------------------------------------
// Draggable staff card — avatar is the visual anchor; grip stays subtle
// ---------------------------------------------------------------------------
const DraggableEmployeeCard: React.FC<{
  employee: Employee;
  isOverlay?: boolean;
}> = ({ employee, isOverlay = false }) => {
  const { tasks } = useApp();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: employee.employee_uid,
    data: { employee },
  });

  const activeTasksCount = tasks.filter(
    (t) =>
      (t.assigned_to_uid === employee.employee_uid ||
        t.employee_uid === employee.employee_uid) &&
      t.status !== 'completed' &&
      t.status !== 'scheduled'
  ).length;

  const style = isDragging && !isOverlay ? { opacity: 0.35 } : undefined;

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      style={style}
      {...(isOverlay ? {} : listeners)}
      {...(isOverlay ? {} : attributes)}
      className={`bg-white rounded-[10px] px-3 py-2.5 border border-[#E9E4DA] shadow-[0_1px_3px_rgba(20,30,24,0.06)] hover:shadow-[0_4px_12px_rgba(20,30,24,0.08)] hover:border-[#2F6B45]/40 transition-[box-shadow,border-color] duration-150 select-none touch-none ${
        isOverlay
          ? 'shadow-[0_8px_24px_rgba(20,30,24,0.14)] rotate-1 scale-[1.03] cursor-grabbing ring-2 ring-[#2F6B45]'
          : 'cursor-grab active:cursor-grabbing'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-full text-white flex items-center justify-center font-semibold text-[11px] shrink-0"
          style={{ backgroundColor: employee.avatar_color || '#2F6B45' }}
        >
          {getInitials(employee.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold text-[13px] text-[#17221B] leading-tight truncate">
            {employee.name}
          </h4>
          <p className="text-[11px] text-[#66706A] font-body truncate">
            {employee.job_title}
            {employee.department ? ` · ${employee.department}` : ''}
          </p>
        </div>
        <div
          className="text-[#B8B2A4] p-0.5 shrink-0"
          title="Drag to another zone or area"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
      </div>

      {((employee.status === 'On Leave' || employee.leave_status) ||
        activeTasksCount > 0) && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[#F2EFE8] text-[10px]">
          {(employee.status === 'On Leave' || employee.leave_status) && (
            <span className="px-1.5 py-0.5 rounded-[5px] bg-[#FFF3E4] text-[#C98232] font-semibold text-[9px] uppercase tracking-wide">
              On Leave
            </span>
          )}
          {activeTasksCount > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[#2F6B45] font-semibold"
              title={`${activeTasksCount} active tasks`}
            >
              <CheckSquare className="w-3 h-3" />
              <span>{activeTasksCount}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Droppable column — zone lane / area-wide lane / unallocated lane
// ---------------------------------------------------------------------------
const DroppableColumn: React.FC<{
  id: string;
  title: string;
  subtitle?: string;
  kind?: 'zone' | 'area' | 'unallocated';
  employees: Employee[];
  minHeight?: string;
}> = ({ id, title, subtitle, kind = 'zone', employees }) => {
  const { setNodeRef, isOver } = useDroppable({ id });

  const shell =
    kind === 'unallocated'
      ? 'bg-[#FDF8F0] border-[#EFE0C8]'
      : kind === 'area'
      ? 'bg-[#EDF3ED] border-[#D5E2D7] border-dashed'
      : 'bg-white border-[#E9E4DA]';

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-[12px] border p-2.5 w-[228px] shrink-0 transition-colors duration-150 ${shell} ${
        isOver
          ? 'border-[#2F6B45] bg-[#E7F0E9] ring-1 ring-[#2F6B45]/30'
          : ''
      }`}
    >
      {/* Column header */}
      <div className="flex items-start justify-between gap-2 mb-2 px-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {kind === 'unallocated' ? (
            <UserX className="w-3.5 h-3.5 text-[#C98232] shrink-0" />
          ) : kind === 'area' ? (
            <MapPin className="w-3.5 h-3.5 text-[#2F6B45] shrink-0" />
          ) : (
            <Layers className="w-3.5 h-3.5 text-[#66706A] shrink-0" />
          )}
          <div className="min-w-0">
            <h3 className="font-semibold text-[13px] text-[#17221B] leading-tight truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="text-[10px] text-[#8A918C] leading-tight mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide shrink-0 mt-0.5 ${
            employees.length > 0
              ? kind === 'unallocated'
                ? 'text-[#C98232]'
                : 'text-[#2F6B45]'
              : 'text-[#8A918C]'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              employees.length > 0
                ? kind === 'unallocated'
                  ? 'bg-[#C98232]'
                  : 'bg-[#2F6B45]'
                : 'bg-[#CFC9BB]'
            }`}
          />
          {employees.length}
        </span>
      </div>

      {/* Staff cards / compact empty drop target */}
      <div className="flex-1 space-y-2">
        {employees.length === 0 ? (
          <div
            className={`flex items-center justify-center h-[52px] rounded-[8px] border border-dashed text-[11px] transition-colors duration-150 ${
              isOver
                ? 'border-[#2F6B45] text-[#2F6B45] bg-white/60 font-medium'
                : kind === 'area'
                ? 'border-[#C5D6C8] text-[#5F7A64]'
                : 'border-[#DDD6C7] text-[#8A918C]'
            }`}
          >
            Drop staff here
          </div>
        ) : (
          <>
            {employees.map((emp) => (
              <DraggableEmployeeCard key={emp.employee_uid} employee={emp} />
            ))}
            <p
              className={`text-center text-[10px] pt-0.5 transition-colors ${
                isOver ? 'text-[#2F6B45] font-medium' : 'text-[#A9A49A]'
              }`}
            >
              {isOver ? 'Drop staff here' : 'Drop to add staff'}
            </p>
          </>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Zone board — areas as floor containers, zones wrap inside, unallocated
// pinned left. No horizontal scroll: zones wrap, areas flow vertically.
// ---------------------------------------------------------------------------
export const ZoneBoard: React.FC<ZoneBoardProps> = ({ onOpenCreateModal }) => {
  const {
    currentPropertyAreas,
    currentPropertyZones,
    currentPropertyEmployees,
    currentPropertyUnallocatedEmployees,
    assignEmployeeToZone,
    assignEmployeeToArea,
    activeProperty,
  } = useApp();

  const [activeDragEmp, setActiveDragEmp] = useState<Employee | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const emp = event.active.data.current?.employee as Employee | undefined;
    if (emp) setActiveDragEmp(emp);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragEmp(null);

    if (!over) return;

    const employeeUid = active.id as string;
    const targetColumnId = over.id as string;

    if (targetColumnId === 'unallocated') {
      assignEmployeeToZone(employeeUid, null); // clears zone + area
    } else if (targetColumnId.startsWith('area:')) {
      assignEmployeeToArea(employeeUid, targetColumnId.slice(5));
    } else {
      assignEmployeeToZone(employeeUid, targetColumnId);
    }
  };

  // Group zones under their area containers — zones with no area render flat
  const sortedAreas = [...currentPropertyAreas].sort(
    (a, b) => a.level_number - b.level_number
  );
  const zonesByArea = new Map<string, Zone[]>();
  const ungroupedZones: Zone[] = [];
  for (const z of currentPropertyZones) {
    if (z.area_uid) {
      const list = zonesByArea.get(z.area_uid) || [];
      list.push(z);
      zonesByArea.set(z.area_uid, list);
    } else {
      ungroupedZones.push(z);
    }
  }

  const renderZoneColumn = (zone: Zone) => (
    <DroppableColumn
      key={zone.zone_uid}
      id={zone.zone_uid}
      title={zone.name}
      subtitle={zone.code}
      employees={currentPropertyEmployees.filter(
        (e) => e.zone_uid === zone.zone_uid
      )}
    />
  );

  return (
    <div className="space-y-4">
      {/* Compact operational info strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 px-3 py-2 rounded-[10px] bg-[#F1EEE7] text-[11px] text-[#66706A]">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#2F6B45] shrink-0" />
          <span>
            <strong className="font-semibold text-[#17221B]">
              Spatial Staff Allocation
            </strong>
            <span className="hidden sm:inline">
              {' '}
              — drag staff between zones to assign physical coverage.
            </span>
          </span>
        </div>
        <span className="text-[#8A918C]">Changes save automatically</span>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-col lg:flex-row gap-5 items-start min-h-[55vh]">
          {/* Unallocated lane — pinned left, warm accent for the exception */}
          <div className="w-full lg:w-[248px] lg:shrink-0">
            <div className="flex items-center justify-between mb-2 px-0.5">
              <div>
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8A918C]">
                  Unallocated
                </h2>
                <p className="text-[10px] text-[#B0AA9C]">Floating property pool</p>
              </div>
              <button
                onClick={onOpenCreateModal}
                title="Add staff member"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2F6B45] hover:text-[#245538] transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add staff</span>
              </button>
            </div>
            <DroppableColumn
              id="unallocated"
              title="Unallocated Staff"
              subtitle={`${currentPropertyUnallocatedEmployees.length} person${
                currentPropertyUnallocatedEmployees.length === 1 ? '' : 's'
              }`}
              kind="unallocated"
              employees={currentPropertyUnallocatedEmployees}
            />
          </div>

          {/* Floor / area containers — stack vertically, zones wrap inside */}
          <div className="flex-1 min-w-0 space-y-4">
            {sortedAreas.map((area) => {
              const areaZones = zonesByArea.get(area.area_uid) || [];
              const areaEmployees = currentPropertyEmployees.filter(
                (e) => e.area_uid === area.area_uid
              );
              const zoneStaff = currentPropertyEmployees.filter((e) =>
                areaZones.some((z) => z.zone_uid === e.zone_uid)
              ).length;
              return (
                <section
                  key={area.area_uid}
                  className="rounded-[14px] border border-[#E7E3D9] bg-[#F5F3EE] p-4"
                >
                  {/* Floor header — visually dominates its zones */}
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <MapPin className="w-4 h-4 text-[#2F6B45] shrink-0" />
                      <h2 className="font-display font-semibold text-[15px] text-[#17221B] tracking-tight truncate">
                        {area.name}
                      </h2>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-[#8A918C] shrink-0">
                      <span>{area.code}</span>
                      <span className="text-[#D8D2C4]">·</span>
                      <span>
                        {areaZones.length} zone{areaZones.length === 1 ? '' : 's'}
                      </span>
                      <span className="text-[#D8D2C4]">·</span>
                      <span className={zoneStaff + areaEmployees.length > 0 ? 'text-[#2F6B45]' : ''}>
                        {zoneStaff + areaEmployees.length} staff
                      </span>
                    </div>
                  </div>

                  {/* Area-wide lane first, then wrapped zone cards */}
                  <div className="flex flex-wrap gap-3">
                    <DroppableColumn
                      id={`area:${area.area_uid}`}
                      title={`Entire ${area.name}`}
                      subtitle="Covers every zone in this area"
                      kind="area"
                      employees={areaEmployees}
                    />
                    {areaZones.map(renderZoneColumn)}
                  </div>
                </section>
              );
            })}

            {/* Zones not inside any area */}
            {ungroupedZones.length > 0 && (
              <section
                className={
                  sortedAreas.length
                    ? 'rounded-[14px] border border-[#E7E3D9] bg-[#F5F3EE] p-4'
                    : ''
                }
              >
                {sortedAreas.length > 0 && (
                  <div className="flex items-center gap-2 mb-3">
                    <Layers className="w-4 h-4 text-[#66706A] shrink-0" />
                    <h2 className="font-display font-semibold text-[15px] text-[#17221B] tracking-tight">
                      Other Zones
                    </h2>
                  </div>
                )}
                <div className="flex flex-wrap gap-3">
                  {ungroupedZones.map(renderZoneColumn)}
                </div>
              </section>
            )}

            {currentPropertyZones.length === 0 && (
              <div className="rounded-[14px] border border-dashed border-[#DDD6C7] p-8 text-center text-[12px] text-[#8A918C]">
                No zones configured for {activeProperty?.name || 'this property'} yet.
              </div>
            )}
          </div>
        </div>

        {/* Drag Overlay for smooth preview */}
        <DragOverlay>
          {activeDragEmp ? (
            <DraggableEmployeeCard employee={activeDragEmp} isOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
};

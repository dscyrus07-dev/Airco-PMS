import React, { useState } from 'react';
import {
  Layers, Building2, Bed, Users, ArrowRight, ChevronDown, ChevronRight, MapPin,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Zone } from '../../types';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ZoneWorkspace } from '../zones/ZoneWorkspace';
import { ZONE_TYPE_LABELS, zoneSupportsUnits } from '../../lib/zoneUtils';
import { isEmployeeAssignable } from '../../lib/employeeUtils';

/**
 * Raise Maintenance Ticket — the employee's coverage map. Opening a zone
 * reuses the real ZoneWorkspace where per-unit maintenance tickets are
 * raised; tickets enter the unified task-allocation pipeline and land in
 * My Tasks.
 */
export const RaiseMaintenanceTicketView: React.FC = () => {
  const {
    currentPropertyAreas,
    currentPropertyZones,
    currentPropertyRooms,
    currentPropertyDorms,
    currentPropertyEmployees,
    employeeRecord,
    activeProperty,
  } = useApp();

  const [openedZoneUid, setOpenedZoneUid] = useState<string | null>(null);
  const [collapsedAreas, setCollapsedAreas] = useState<Record<string, boolean>>({});

  // ── Jurisdiction: zone-assigned → that zone; area-assigned → every zone in
  //    the area (including legacy floor-name matching); else nothing.
  const scopedZones = currentPropertyZones.filter((z) => {
    if (employeeRecord?.zone_uid) return z.zone_uid === employeeRecord.zone_uid;
    if (employeeRecord?.area_uid) {
      const area = currentPropertyAreas.find(
        (a) => a.area_uid === employeeRecord.area_uid
      );
      return z.area_uid === employeeRecord.area_uid ||
        (!z.area_uid && !!area && z.floor === area.name);
    }
    return false;
  });

  const openedZone = scopedZones.find((z) => z.zone_uid === openedZoneUid);
  if (openedZone) {
    return <ZoneWorkspace zone={openedZone} onBack={() => setOpenedZoneUid(null)} />;
  }

  const toggleAreaCollapse = (key: string) =>
    setCollapsedAreas((prev) => ({ ...prev, [key]: !prev[key] }));

  const areaGroups = currentPropertyAreas
    .map((area) => ({
      area,
      zones: scopedZones.filter(
        (z) => z.area_uid === area.area_uid || (!z.area_uid && z.floor === area.name)
      ),
    }))
    .filter((g) => g.zones.length > 0);

  const unassignedZones = scopedZones.filter((z) => {
    if (z.area_uid && currentPropertyAreas.some((a) => a.area_uid === z.area_uid)) return false;
    if (!z.area_uid && currentPropertyAreas.some((a) => a.name === z.floor)) return false;
    return true;
  });

  const renderZoneCard = (zone: Zone) => {
    const zoneRooms = currentPropertyRooms.filter((r) => r.zone_uid === zone.zone_uid);
    const zoneDorms = currentPropertyDorms.filter((d) => d.zone_uid === zone.zone_uid);
    const zoneStaff = currentPropertyEmployees.filter(
      (e) => e.zone_uid === zone.zone_uid && isEmployeeAssignable(e)
    );
    const totalBeds =
      zoneDorms.reduce((n, d) => n + d.beds.length, 0) +
      zoneRooms.reduce((n, r) => n + r.bed_count, 0);
    const isMyZone = zone.zone_uid === employeeRecord?.zone_uid;
    const referencedArea = currentPropertyAreas.find((a) => a.area_uid === zone.area_uid);

    return (
      <Card
        key={zone.zone_uid}
        hoverEffect
        className="flex flex-col justify-between group relative bg-white border-[#E6E1D7]"
      >
        <div>
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[#F4F0E8] text-[#555047] border border-[#E2DDD5]">
              {zone.code}
            </span>
            <Badge variant={zoneSupportsUnits(zone) ? 'sage' : 'lavender'} size="sm">
              {ZONE_TYPE_LABELS[zone.zone_type || 'stay']}
            </Badge>
            {referencedArea && (
              <span className="text-[11px] font-medium text-[#386641] bg-[#EBF3EC] px-2 py-0.5 rounded-[6px] border border-[#CFE4D1] truncate max-w-[140px]">
                {referencedArea.name}
              </span>
            )}
            {isMyZone && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[6px] bg-[#386641] text-white">
                Your zone
              </span>
            )}
          </div>

          <h3
            onClick={() => setOpenedZoneUid(zone.zone_uid)}
            className="font-display font-bold text-lg text-[#24221F] group-hover:text-[#386641] transition-colors cursor-pointer tracking-tight"
          >
            {zone.name}
          </h3>
          {zone.description && (
            <p className="text-xs text-[#6C675F] font-body mt-1 line-clamp-2">
              {zone.description}
            </p>
          )}

          <div className="my-4 p-3 bg-[#FAF8F5] border border-[#EAE5DC] rounded-[10px] text-xs text-[#45413B] font-body flex items-center justify-between flex-wrap gap-2">
            {zoneSupportsUnits(zone) ? (
              <>
                <div className="flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-[#2563EB]" />
                  <span><strong>{zoneRooms.length}</strong> Rooms</span>
                </div>
                <span className="text-[#C8C2B7]">·</span>
                <div className="flex items-center gap-1.5">
                  <Bed className="w-3.5 h-3.5 text-[#C8681A]" />
                  <span><strong>{zoneDorms.length}</strong> Dorms</span>
                </div>
                <span className="text-[#C8C2B7]">·</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#7C6DAF]" />
                  <span><strong>{totalBeds}</strong> Beds</span>
                </div>
                <span className="text-[#C8C2B7]">·</span>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 text-[#736E65]">
                  <Layers className="w-3.5 h-3.5" />
                  <span>No guest units</span>
                </div>
                <span className="text-[#C8C2B7]">·</span>
              </>
            )}
            <div className="flex items-center gap-1.5 text-[#2E6038]">
              <Users className="w-3.5 h-3.5" />
              <span><strong>{zoneStaff.length}</strong> Staff</span>
            </div>
          </div>
        </div>

        <Button
          variant="sage"
          size="sm"
          className="w-full justify-between group-hover:bg-[#386641] group-hover:text-white transition-all cursor-pointer mt-2"
          onClick={() => setOpenedZoneUid(zone.zone_uid)}
        >
          <span>Open Zone — report per unit</span>
          <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Jurisdiction map — location context for the ticket */}
      {scopedZones.length === 0 ? (
        <Card className="p-10 text-center border-dashed border-[#D9D3C7]">
          <div className="w-12 h-12 rounded-full bg-[#EBF3EC] text-[#386641] flex items-center justify-center mx-auto mb-3">
            <MapPin className="w-6 h-6" />
          </div>
          <h3 className="font-display font-semibold text-lg text-[#24221F]">
            No Zone Assigned Yet
          </h3>
          <p className="font-body text-sm text-[#6C675F] max-w-sm mx-auto mt-1">
            Once your property manager assigns you a zone or area, its rooms,
            dorms and washrooms will appear here for ticket reporting.
          </p>
        </Card>
      ) : (
        <div className="space-y-7">
          <div className="flex items-center gap-2.5">
            <span className="font-display font-bold text-base text-[#24221F]">
              Your Coverage — {scopedZones.length} zone{scopedZones.length === 1 ? '' : 's'}
            </span>
            <span className="text-xs text-[#8C867C]">at {activeProperty?.name}</span>
            <div className="flex-1 border-t border-[#EAE5DC] ml-2" />
          </div>
          {areaGroups.map(({ area, zones: zs }) => {
            const collapsed = !!collapsedAreas[area.area_uid];
            const areaBeds =
              zs.reduce(
                (n, z) =>
                  n +
                  currentPropertyDorms
                    .filter((d) => d.zone_uid === z.zone_uid)
                    .reduce((m, d) => m + d.beds.length, 0) +
                  currentPropertyRooms
                    .filter((r) => r.zone_uid === z.zone_uid)
                    .reduce((m, r) => m + r.bed_count, 0),
                0
              );
            return (
              <section key={area.area_uid} className="space-y-3">
                <button
                  onClick={() => toggleAreaCollapse(area.area_uid)}
                  className="flex items-center gap-2.5 w-full text-left cursor-pointer group"
                >
                  {collapsed
                    ? <ChevronRight className="w-4 h-4 text-[#736E65]" />
                    : <ChevronDown className="w-4 h-4 text-[#736E65]" />}
                  <span className="font-display font-bold text-base text-[#24221F] group-hover:text-[#386641] transition-colors">
                    {area.name}
                  </span>
                  <span className="text-xs text-[#8C867C]">
                    {zs.length} zone{zs.length === 1 ? '' : 's'} · {areaBeds} beds
                  </span>
                  <div className="flex-1 border-t border-[#EAE5DC] ml-2" />
                </button>
                {!collapsed && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {zs.map(renderZoneCard)}
                  </div>
                )}
              </section>
            );
          })}
          {unassignedZones.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="font-display font-bold text-base text-[#24221F]">Other Zones</span>
                <div className="flex-1 border-t border-[#EAE5DC] ml-2" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {unassignedZones.map(renderZoneCard)}
              </div>
            </section>
          )}
        </div>
      )}

    </div>
  );
};

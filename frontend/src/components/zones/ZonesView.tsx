import React, { useState } from 'react';
import {
  Layers,
  Plus,
  MoreVertical,
  Edit,
  Trash2,
  Building2,
  Bed,
  Users,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Compass,
  MapPin,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { CreateZoneModal } from './CreateZoneModal';
import { CreateAreaModal } from './CreateAreaModal';
import { ZoneWorkspace } from './ZoneWorkspace';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import { Zone, Area, ZoneType } from '../../types';
import { ZONE_TYPE_LABELS, ZONE_TYPE_OPTIONS, zoneSupportsUnits } from '../../lib/zoneUtils';

export const ZonesView: React.FC = () => {
  const {
    currentPropertyAreas,
    currentPropertyZones,
    currentPropertyRooms,
    currentPropertyDorms,
    currentPropertyEmployees,
    openedZoneUid,
    setOpenedZoneUid,
    deleteZone,
    updateZone,
    deleteArea,
    updateArea,
    activeProperty,
  } = useApp();

  // Modals & Dialogs
  const [createZoneModalOpen, setCreateZoneModalOpen] = useState(false);
  const [createAreaModalOpen, setCreateAreaModalOpen] = useState(false);
  const [activeAreaForNewZone, setActiveAreaForNewZone] = useState<string | undefined>(undefined);

  // Menu dropdowns
  const [activeMenuZoneUid, setActiveMenuZoneUid] = useState<string | null>(null);
  const [activeMenuAreaUid, setActiveMenuAreaUid] = useState<string | null>(null);

  // Deletions
  const [zoneToDelete, setZoneToDelete] = useState<Zone | null>(null);
  const [areaToDelete, setAreaToDelete] = useState<Area | null>(null);

  // Edit Zone Modal state
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [editName, setEditName] = useState('');
  const [editAreaUid, setEditAreaUid] = useState<string>('');
  const [editZoneType, setEditZoneType] = useState<ZoneType>('stay');
  const [editDescription, setEditDescription] = useState('');

  // Edit Area Modal state
  const [editingArea, setEditingArea] = useState<Area | null>(null);
  const [editAreaName, setEditAreaName] = useState('');
  const [editAreaDescription, setEditAreaDescription] = useState('');

  // Filter & View layout modes
  const [selectedAreaFilter, setSelectedAreaFilter] = useState<string>('all');
  const [viewGrouping, setViewGrouping] = useState<'by_area' | 'all_zones'>('by_area');
  const [collapsedAreas, setCollapsedAreas] = useState<Record<string, boolean>>({});

  // If a zone is actively opened, show its dedicated workspace
  const activeZone = currentPropertyZones.find((z) => z.zone_uid === openedZoneUid);
  if (activeZone) {
    return <ZoneWorkspace zone={activeZone} onBack={() => setOpenedZoneUid(null)} />;
  }

  // Toggle collapse state for an area section
  const toggleAreaCollapse = (areaKey: string) => {
    setCollapsedAreas((prev) => ({
      ...prev,
      [areaKey]: !prev[areaKey],
    }));
  };

  // Handlers for Zone Edit
  const handleStartEditZone = (zone: Zone) => {
    setEditingZone(zone);
    setEditName(zone.name);
    setEditAreaUid(zone.area_uid || '');
    setEditZoneType(zone.zone_type || 'stay');
    setEditDescription(zone.description || '');
    setActiveMenuZoneUid(null);
  };

  const handleSaveEditZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingZone || !editName.trim()) return;
    const chosenArea = currentPropertyAreas.find((a) => a.area_uid === editAreaUid);
    try {
      await updateZone(editingZone.zone_uid, {
        name: editName.trim(),
        area_uid: editAreaUid ? editAreaUid : null,
        floor: chosenArea ? chosenArea.name : undefined,
        zone_type: editZoneType,
        description: editDescription.trim(),
      });
      setEditingZone(null);
    } catch {
      // Error toast handled by the context layer — keep dialog open
    }
  };

  // Handlers for Area Edit
  const handleStartEditArea = (area: Area) => {
    setEditingArea(area);
    setEditAreaName(area.name);
    setEditAreaDescription(area.description || '');
    setActiveMenuAreaUid(null);
  };

  const handleSaveEditArea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingArea || !editAreaName.trim()) return;
    try {
      await updateArea(editingArea.area_uid, {
        name: editAreaName.trim(),
        description: editAreaDescription.trim() || undefined,
      });
      setEditingArea(null);
    } catch {
      // Error toast handled by the context layer — keep dialog open
    }
  };

  // Group zones by area
  // Areas defined in property
  const areaGroups = currentPropertyAreas.map((area) => {
    // A zone belongs to this area if either zone.area_uid === area.area_uid OR floor matches area name
    const zonesInArea = currentPropertyZones.filter(
      (z) => z.area_uid === area.area_uid || (!z.area_uid && z.floor === area.name)
    );
    return {
      area,
      zones: zonesInArea,
    };
  });

  // Zones without matching area (unassigned / custom floor)
  const unassignedZones = currentPropertyZones.filter((z) => {
    if (z.area_uid && currentPropertyAreas.some((a) => a.area_uid === z.area_uid)) {
      return false;
    }
    if (!z.area_uid && currentPropertyAreas.some((a) => a.name === z.floor)) {
      return false;
    }
    return true;
  });

  // Filtered by selected area filter if applied
  const visibleAreaGroups =
    selectedAreaFilter === 'all'
      ? areaGroups
      : selectedAreaFilter === 'unassigned'
      ? []
      : areaGroups.filter((g) => g.area.area_uid === selectedAreaFilter);

  const showUnassignedGroup =
    (selectedAreaFilter === 'all' || selectedAreaFilter === 'unassigned') &&
    unassignedZones.length > 0;

  // Renders an individual Zone Card
  const renderZoneCard = (zone: Zone) => {
    const zoneRooms = currentPropertyRooms.filter((r) => r.zone_uid === zone.zone_uid);
    const zoneDorms = currentPropertyDorms.filter((d) => d.zone_uid === zone.zone_uid);
    const zoneEmployees = currentPropertyEmployees.filter(
      (e) => e.zone_uid === zone.zone_uid
    );

    const zoneDormBeds = zoneDorms.reduce((acc, d) => acc + d.beds.length, 0);
    const zoneRoomBeds = zoneRooms.reduce((acc, r) => acc + r.bed_count, 0);
    const zoneTotalBeds = zoneDormBeds + zoneRoomBeds;

    const isMenuOpen = activeMenuZoneUid === zone.zone_uid;

    // Resolve Area name directly if present
    const referencedArea = currentPropertyAreas.find((a) => a.area_uid === zone.area_uid);

    return (
      <Card
        key={zone.zone_uid}
        hoverEffect
        className="flex flex-col justify-between group relative bg-white border-[#E6E1D7]"
      >
        <div>
          {/* Top Bar with ID and Menu */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-1.5 flex-wrap">
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
            </div>

            {/* 3-Dots Action Menu */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveMenuZoneUid(isMenuOpen ? null : zone.zone_uid);
                }}
                className="p-1 rounded-[8px] text-[#736E65] hover:text-[#24221F] hover:bg-[#F2ECE3] transition-colors cursor-pointer"
                title="Zone options"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {isMenuOpen && (
                <div className="absolute right-0 top-8 z-30 w-44 bg-white border border-[#E4DFD5] rounded-[12px] shadow-lg py-1">
                  <button
                    onClick={() => {
                      setActiveMenuZoneUid(null);
                      setOpenedZoneUid(zone.zone_uid);
                    }}
                    className="w-full text-left px-3.5 py-2 text-xs font-medium text-[#24221F] hover:bg-[#FAF8F5] flex items-center gap-2 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-[#555047]" />
                    <span>Open Workspace</span>
                  </button>
                  <button
                    onClick={() => handleStartEditZone(zone)}
                    className="w-full text-left px-3.5 py-2 text-xs font-medium text-[#24221F] hover:bg-[#FAF8F5] flex items-center gap-2 cursor-pointer"
                  >
                    <Edit className="w-3.5 h-3.5 text-[#555047]" />
                    <span>Edit Details</span>
                  </button>
                  <button
                    onClick={() => {
                      setActiveMenuZoneUid(null);
                      setZoneToDelete(zone);
                    }}
                    className="w-full text-left px-3.5 py-2 text-xs font-medium text-[#B91C1C] hover:bg-[#FEF2F2] flex items-center gap-2 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Zone</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Zone Name */}
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

          {/* Formatted metrics string — stay zones show unit counts; other zone
              types are bed-free so only staff/tasks are meaningful */}
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
                  <span><strong>{zoneTotalBeds}</strong> Beds</span>
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
              <span><strong>{zoneEmployees.length}</strong> Staff</span>
            </div>
          </div>
        </div>

        {/* Primary CTA */}
        <Button
          variant="sage"
          size="sm"
          className="w-full justify-between group-hover:bg-[#386641] group-hover:text-white transition-all cursor-pointer mt-2"
          onClick={() => setOpenedZoneUid(zone.zone_uid)}
        >
          <span>Open Zone Workspace</span>
          <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header with Title and CTAs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display font-bold text-2xl sm:text-[28px] text-[#24221F] tracking-tight">
              Zones & Areas Management
            </h1>
            <div className="flex items-center gap-1.5">
              <Badge variant="sage" size="md">
                {currentPropertyAreas.length} Areas
              </Badge>
              <Badge variant="neutral" size="md">
                {currentPropertyZones.length} Zones
              </Badge>
            </div>
          </div>
          <p className="font-body text-sm text-[#6C675F] mt-1">
            Physical elevations (floors) and operational zones mapped directly across{' '}
            <strong className="text-[#24221F] font-semibold">{activeProperty?.name}</strong>
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreateAreaModalOpen(true)}
            className="gap-1.5"
          >
            <Compass className="w-4 h-4 text-[#386641]" />
            <span>Add Area (Floor)</span>
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setActiveAreaForNewZone(undefined);
              setCreateZoneModalOpen(true);
            }}
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Add Zone</span>
          </Button>
        </div>
      </div>

      {/* Filter and View Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-white border border-[#EAE5DC] rounded-[14px]">
        {/* Left: Filter by Area */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-[#555047] uppercase tracking-wider mr-1">
            Filter:
          </span>
          <button
            onClick={() => setSelectedAreaFilter('all')}
            className={`px-3 py-1 rounded-[8px] text-xs font-medium transition-all cursor-pointer ${
              selectedAreaFilter === 'all'
                ? 'bg-[#386641] text-white shadow-xs'
                : 'bg-[#FAF8F5] text-[#555047] hover:bg-[#F0ECE4] border border-[#DDD7CB]'
            }`}
          >
            All Areas ({currentPropertyZones.length} Zones)
          </button>

          {currentPropertyAreas.map((area) => {
            const count = currentPropertyZones.filter(
              (z) => z.area_uid === area.area_uid || (!z.area_uid && z.floor === area.name)
            ).length;
            return (
              <button
                key={area.area_uid}
                onClick={() => setSelectedAreaFilter(area.area_uid)}
                className={`px-3 py-1 rounded-[8px] text-xs font-medium transition-all cursor-pointer ${
                  selectedAreaFilter === area.area_uid
                    ? 'bg-[#386641] text-white shadow-xs'
                    : 'bg-[#FAF8F5] text-[#555047] hover:bg-[#F0ECE4] border border-[#DDD7CB]'
                }`}
              >
                {area.name} ({count})
              </button>
            );
          })}

          {unassignedZones.length > 0 && (
            <button
              onClick={() => setSelectedAreaFilter('unassigned')}
              className={`px-3 py-1 rounded-[8px] text-xs font-medium transition-all cursor-pointer ${
                selectedAreaFilter === 'unassigned'
                  ? 'bg-[#386641] text-white shadow-xs'
                  : 'bg-[#FAF8F5] text-[#555047] hover:bg-[#F0ECE4] border border-[#DDD7CB]'
              }`}
            >
              Other Zones ({unassignedZones.length})
            </button>
          )}
        </div>

        {/* Right: View Grouping toggle */}
        <div className="flex items-center gap-1.5 self-end sm:self-auto">
          <span className="text-xs text-[#736E65] mr-1 hidden sm:inline">Group By:</span>
          <button
            onClick={() => setViewGrouping('by_area')}
            className={`px-2.5 py-1 rounded-[8px] text-xs font-medium transition-all cursor-pointer ${
              viewGrouping === 'by_area'
                ? 'bg-[#24221F] text-white'
                : 'text-[#6C675F] hover:text-[#24221F] hover:bg-[#F5F2EB]'
            }`}
          >
            Areas (Floors)
          </button>
          <button
            onClick={() => setViewGrouping('all_zones')}
            className={`px-2.5 py-1 rounded-[8px] text-xs font-medium transition-all cursor-pointer ${
              viewGrouping === 'all_zones'
                ? 'bg-[#24221F] text-white'
                : 'text-[#6C675F] hover:text-[#24221F] hover:bg-[#F5F2EB]'
            }`}
          >
            Direct Zone Grid
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {currentPropertyZones.length === 0 && currentPropertyAreas.length === 0 ? (
        <Card className="p-12 text-center border-dashed border-[#D9D3C7]">
          <div className="w-12 h-12 rounded-full bg-[#EBF3EC] text-[#386641] flex items-center justify-center mx-auto mb-3">
            <Layers className="w-6 h-6" />
          </div>
          <h3 className="font-display font-semibold text-lg text-[#24221F]">
            No Areas or Zones Created Yet
          </h3>
          <p className="font-body text-sm text-[#6C675F] max-w-sm mx-auto mt-1 mb-5">
            Create physical floors (Areas) and operational Zones to organize rooms, dorms, and staff.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" onClick={() => setCreateAreaModalOpen(true)}>
              <Compass className="w-4 h-4 mr-1.5" />
              <span>Create Floor Area</span>
            </Button>
            <Button variant="primary" onClick={() => setCreateZoneModalOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" />
              <span>Create First Zone</span>
            </Button>
          </div>
        </Card>
      ) : viewGrouping === 'by_area' ? (
        /* Hierarchical Area-by-Area Sections */
        <div className="space-y-7">
          {visibleAreaGroups.map(({ area, zones }) => {
            const isCollapsed = !!collapsedAreas[area.area_uid];

            // Area aggregated statistics
            const areaRooms = currentPropertyRooms.filter((r) =>
              zones.some((z) => z.zone_uid === r.zone_uid)
            );
            const areaDorms = currentPropertyDorms.filter((d) =>
              zones.some((z) => z.zone_uid === d.zone_uid)
            );
            const areaEmployees = currentPropertyEmployees.filter((e) =>
              zones.some((z) => z.zone_uid === e.zone_uid)
            );
            const areaDormBeds = areaDorms.reduce((acc, d) => acc + d.beds.length, 0);
            const areaRoomBeds = areaRooms.reduce((acc, r) => acc + r.bed_count, 0);
            const areaTotalBeds = areaDormBeds + areaRoomBeds;

            const isAreaMenuOpen = activeMenuAreaUid === area.area_uid;

            return (
              <div
                key={area.area_uid}
                className="bg-white border border-[#E6E1D7] rounded-[18px] p-5 shadow-xs transition-all"
              >
                {/* Area Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#F0ECE4]">
                  <div className="flex items-start sm:items-center gap-3">
                    <button
                      onClick={() => toggleAreaCollapse(area.area_uid)}
                      className="p-1 rounded-[6px] hover:bg-[#F5F2EB] text-[#787268] cursor-pointer mt-0.5 sm:mt-0"
                      title={isCollapsed ? 'Expand Area' : 'Collapse Area'}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-5 h-5" />
                      ) : (
                        <ChevronDown className="w-5 h-5" />
                      )}
                    </button>

                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[#FAF5EC] text-[#554D40] border border-[#E8DFC8]">
                          {area.code}
                        </span>
                        <h2 className="font-display font-bold text-xl text-[#24221F] tracking-tight">
                          {area.name}
                        </h2>
                      </div>
                      {area.description && (
                        <p className="text-xs text-[#6C675F] font-body mt-0.5">
                          {area.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Area Metrics & Actions */}
                  <div className="flex items-center gap-2 flex-wrap self-end sm:self-auto">
                    {/* Compact Area Metrics Pill */}
                    <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-[#FAF8F5] border border-[#EAE5DC] rounded-[10px] text-xs text-[#555047]">
                      <span><strong>{zones.length}</strong> {zones.length === 1 ? 'Zone' : 'Zones'}</span>
                      <span className="text-[#DDD7CB]">·</span>
                      <span><strong>{areaRooms.length}</strong> Rooms</span>
                      <span className="text-[#DDD7CB]">·</span>
                      <span><strong>{areaDorms.length}</strong> Dorms</span>
                      <span className="text-[#DDD7CB]">·</span>
                      <span><strong>{areaTotalBeds}</strong> Beds</span>
                      <span className="text-[#DDD7CB]">·</span>
                      <span className="text-[#2E6038]"><strong>{areaEmployees.length}</strong> Staff</span>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setActiveAreaForNewZone(area.area_uid);
                        setCreateZoneModalOpen(true);
                      }}
                      className="text-xs gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Zone Here</span>
                    </Button>

                    {/* Area Options Menu */}
                    <div className="relative">
                      <button
                        onClick={() =>
                          setActiveMenuAreaUid(isAreaMenuOpen ? null : area.area_uid)
                        }
                        className="p-1.5 rounded-[8px] text-[#736E65] hover:text-[#24221F] hover:bg-[#F2ECE3] transition-colors cursor-pointer"
                        title="Area Actions"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {isAreaMenuOpen && (
                        <div className="absolute right-0 top-8 z-30 w-44 bg-white border border-[#E4DFD5] rounded-[12px] shadow-lg py-1">
                          <button
                            onClick={() => handleStartEditArea(area)}
                            className="w-full text-left px-3.5 py-2 text-xs font-medium text-[#24221F] hover:bg-[#FAF8F5] flex items-center gap-2 cursor-pointer"
                          >
                            <Edit className="w-3.5 h-3.5 text-[#555047]" />
                            <span>Edit Area Details</span>
                          </button>
                          <button
                            onClick={() => {
                              setActiveMenuAreaUid(null);
                              setAreaToDelete(area);
                            }}
                            className="w-full text-left px-3.5 py-2 text-xs font-medium text-[#B91C1C] hover:bg-[#FEF2F2] flex items-center gap-2 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete Area</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Zones inside this Area */}
                {!isCollapsed && (
                  <div className="pt-4">
                    {zones.length === 0 ? (
                      <div className="p-8 text-center bg-[#FAF8F5] border border-dashed border-[#DDD7CB] rounded-[14px]">
                        <p className="text-sm font-medium text-[#736E65]">
                          No operational zones mapped in {area.name}
                        </p>
                        <p className="text-xs text-[#9E988E] mt-0.5">
                          Create a zone to allocate private rooms, dorms, and roster staff on this floor.
                        </p>
                        <Button
                          variant="sage"
                          size="sm"
                          onClick={() => {
                            setActiveAreaForNewZone(area.area_uid);
                            setCreateZoneModalOpen(true);
                          }}
                          className="mt-3.5 gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Create Zone in {area.name}</span>
                        </Button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {zones.map((zone) => renderZoneCard(zone))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Unassigned / Other Zones Section */}
          {showUnassignedGroup && (
            <div className="bg-white border border-[#E6E1D7] rounded-[18px] p-5 shadow-xs">
              <div className="flex items-center justify-between pb-4 border-b border-[#F0ECE4]">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[#F4F0E8] text-[#555047] border border-[#DDD7CB]">
                      OTHER
                    </span>
                    <h2 className="font-display font-bold text-lg text-[#24221F]">
                      Standalone & Custom Zones
                    </h2>
                    <Badge variant="neutral" size="sm">
                      {unassignedZones.length} Zones
                    </Badge>
                  </div>
                  <p className="text-xs text-[#6C675F] mt-0.5">
                    Zones not directly linked to a predefined floor Area.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
                {unassignedZones.map((zone) => renderZoneCard(zone))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Direct Zone Grid View (All zones flat) */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {currentPropertyZones.map((zone) => renderZoneCard(zone))}
        </div>
      )}

      {/* Create Zone Modal */}
      <CreateZoneModal
        isOpen={createZoneModalOpen}
        onClose={() => setCreateZoneModalOpen(false)}
        defaultAreaUid={activeAreaForNewZone}
      />

      {/* Create Area Modal */}
      <CreateAreaModal
        isOpen={createAreaModalOpen}
        onClose={() => setCreateAreaModalOpen(false)}
      />

      {/* Edit Zone Modal */}
      {editingZone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1D1B18]/40">
          <div className="w-full max-w-md bg-white border border-[#E4DFD5] rounded-[18px] p-6 shadow-xl">
            <h3 className="font-display font-bold text-lg text-[#24221F] mb-4">
              Edit Zone Details
            </h3>
            <form onSubmit={handleSaveEditZone} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                  Zone Name
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                  Zone Type
                </label>
                <select
                  value={editZoneType}
                  onChange={(e) => setEditZoneType(e.target.value as ZoneType)}
                  className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
                >
                  {ZONE_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label} — {o.hint}
                    </option>
                  ))}
                </select>
                {editZoneType !== 'stay' && editingZone && zoneSupportsUnits(editingZone) &&
                  (currentPropertyRooms.some((r) => r.zone_uid === editingZone.zone_uid) ||
                    currentPropertyDorms.some((d) => d.zone_uid === editingZone.zone_uid)) && (
                  <p className="text-[11px] text-[#9A4C07] mt-1.5 font-medium">
                    Switching to a non-stay type will move this zone's rooms and dorms to
                    Unallocated.
                  </p>
                )}
              </div>

              {currentPropertyAreas.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                    Belongs to Area
                  </label>
                  <select
                    value={editAreaUid}
                    onChange={(e) => setEditAreaUid(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
                  >
                    {currentPropertyAreas.map((area) => (
                      <option key={area.area_uid} value={area.area_uid}>
                        {area.name} ({area.code})
                      </option>
                    ))}
                    <option value="">Unassigned</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingZone(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Area Modal */}
      {editingArea && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1D1B18]/40">
          <div className="w-full max-w-md bg-white border border-[#E4DFD5] rounded-[18px] p-6 shadow-xl">
            <h3 className="font-display font-bold text-lg text-[#24221F] mb-4">
              Edit Area / Floor Details
            </h3>
            <form onSubmit={handleSaveEditArea} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                  Area Name *
                </label>
                <input
                  type="text"
                  required
                  value={editAreaName}
                  onChange={(e) => setEditAreaName(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={editAreaDescription}
                  onChange={(e) => setEditAreaDescription(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingArea(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Zone Confirmation Dialog */}
      {zoneToDelete && (
        <ConfirmationDialog
          isOpen={!!zoneToDelete}
          onClose={() => setZoneToDelete(null)}
          onConfirm={() => deleteZone(zoneToDelete.zone_uid)}
          entityType="Zone"
          entityName={zoneToDelete.name}
          impactMessage={`Deleting this zone un-assigns all its rooms, dorms, and employees into the Unallocated pool. Their data will NOT be deleted.`}
        />
      )}

      {/* Delete Area Confirmation Dialog */}
      {areaToDelete && (
        <ConfirmationDialog
          isOpen={!!areaToDelete}
          onClose={() => setAreaToDelete(null)}
          onConfirm={() => deleteArea(areaToDelete.area_uid)}
          entityType="Area"
          entityName={areaToDelete.name}
          impactMessage={`Deleting this Area unlinks all its zones. The zones will remain intact as unassigned to an Area.`}
        />
      )}
    </div>
  );
};

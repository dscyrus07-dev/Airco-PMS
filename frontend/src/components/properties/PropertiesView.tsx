import React, { useState } from 'react';
import {
  Building2,
  Plus,
  MapPin,
  MoreVertical,
  ArrowRight,
  Trash2,
  Edit,
  ExternalLink,
  Shield,
  Layers,
  Bed,
  Users,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { CreatePropertyModal } from './CreatePropertyModal';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import { Property } from '../../types';

export const PropertiesView: React.FC = () => {
  const {
    companyProperties: properties,
    zones,
    rooms,
    dorms,
    setActivePropertyUid,
    navigate,
    deleteProperty,
    updateProperty,
  } = useApp();

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [activeMenuPropUid, setActiveMenuPropUid] = useState<string | null>(null);
  const [propertyToDelete, setPropertyToDelete] = useState<Property | null>(null);

  // Edit modal state
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');

  const handleOpenProperty = (property_uid: string) => {
    setActivePropertyUid(property_uid);
    navigate(`/property/${property_uid}/zones`);
  };

  const handleStartEdit = (prop: Property) => {
    setEditingProperty(prop);
    setEditName(prop.name);
    setEditLocation(prop.location);
    setActiveMenuPropUid(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProperty || !editName.trim()) return;
    try {
      await updateProperty(editingProperty.property_uid, {
        name: editName.trim(),
        location: editLocation.trim(),
      });
      setEditingProperty(null);
    } catch {
      // Error toast handled by the context layer — keep dialog open
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Title and Create CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display font-bold text-2xl sm:text-[28px] text-[#24221F] tracking-tight">
              Properties Directory
            </h1>
            <Badge variant="sage" size="md">
              {properties.length} Active
            </Badge>
          </div>
          <p className="font-body text-sm text-[#6C675F] mt-1">
            Physical locations under organizational operations
          </p>
        </div>

        <Button
          variant="primary"
          onClick={() => setCreateModalOpen(true)}
          className="self-start sm:self-auto gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>Add Property</span>
        </Button>
      </div>

      {/* Empty State */}
      {properties.length === 0 ? (
        <Card className="p-12 text-center border-dashed border-[#D9D3C7]">
          <div className="w-12 h-12 rounded-full bg-[#EBF3EC] text-[#386641] flex items-center justify-center mx-auto mb-3">
            <Building2 className="w-6 h-6" />
          </div>
          <h3 className="font-display font-semibold text-lg text-[#24221F]">
            No properties registered
          </h3>
          <p className="font-body text-sm text-[#6C675F] max-w-sm mx-auto mt-1 mb-5">
            Add your first property to start organizing zones, rooms, dorms, and operational teams.
          </p>
          <Button variant="primary" onClick={() => setCreateModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            Add Your First Property
          </Button>
        </Card>
      ) : (
        /* Cards Grid */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {properties.map((property) => {
            // Calculate real-time counts from normalized state
            const propZones = zones.filter((z) => z.property_uid === property.property_uid);
            const propRooms = rooms.filter((r) => r.property_uid === property.property_uid);
            const propDorms = dorms.filter((d) => d.property_uid === property.property_uid);

            const totalBedsInDorms = propDorms.reduce((acc, d) => acc + d.beds.length, 0);
            const totalRoomBeds = propRooms.reduce((acc, r) => acc + r.bed_count, 0);
            const totalBeds = totalBedsInDorms + totalRoomBeds;

            const isMenuOpen = activeMenuPropUid === property.property_uid;

            return (
              <Card
                key={property.property_uid}
                hoverEffect
                className="flex flex-col justify-between relative group"
              >
                <div>
                  {/* Top Bar: Code, Status, Kebab Menu */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[#F3EFE9] text-[#555047] border border-[#E2DDD5]">
                        {property.code}
                      </span>
                      <Badge variant="sage" size="sm">
                        {property.status}
                      </Badge>
                    </div>

                    {/* Kebab Action Menu */}
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuPropUid(isMenuOpen ? null : property.property_uid);
                        }}
                        className="p-1.5 text-[#736E65] hover:text-[#24221F] hover:bg-[#F2ECE3] rounded-[8px] transition-colors cursor-pointer"
                        aria-label="Actions"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {isMenuOpen && (
                        <div
                          className="absolute right-0 top-8 z-30 w-44 bg-[#FFFFFF] border border-[#E4DFD5] rounded-[12px] shadow-[0_8px_20px_rgba(0,0,0,0.08)] py-1.5 animate-in fade-in duration-150"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => {
                              handleOpenProperty(property.property_uid);
                              setActiveMenuPropUid(null);
                            }}
                            className="w-full px-3.5 py-2 text-xs font-medium text-[#24221F] hover:bg-[#F6F3EE] flex items-center gap-2 text-left cursor-pointer"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-[#386641]" />
                            <span>Open Property</span>
                          </button>
                          <button
                            onClick={() => handleStartEdit(property)}
                            className="w-full px-3.5 py-2 text-xs font-medium text-[#24221F] hover:bg-[#F6F3EE] flex items-center gap-2 text-left cursor-pointer"
                          >
                            <Edit className="w-3.5 h-3.5 text-[#736E65]" />
                            <span>Edit Property</span>
                          </button>
                          <div className="my-1 border-t border-[#F0ECE4]" />
                          <button
                            onClick={() => {
                              setPropertyToDelete(property);
                              setActiveMenuPropUid(null);
                            }}
                            className="w-full px-3.5 py-2 text-xs font-medium text-[#C53B3B] hover:bg-[#FDE8E8] flex items-center gap-2 text-left cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete Property</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Property Name & Location */}
                  <h3
                    onClick={() => handleOpenProperty(property.property_uid)}
                    className="font-display font-bold text-lg sm:text-[19px] text-[#24221F] hover:text-[#386641] transition-colors cursor-pointer tracking-tight"
                  >
                    {property.name}
                  </h3>

                  <div className="flex items-center gap-1.5 text-xs text-[#6C675F] mt-1 font-body">
                    <MapPin className="w-3.5 h-3.5 text-[#8F8A80] shrink-0" />
                    <span>{property.location || `${property.city}, ${property.state}`}</span>
                  </div>

                  {/* Compact Metrics String (per spec: e.g. "8 Zones · 24 Rooms · 12 Dorms · 96 Beds") */}
                  <div className="my-4 p-3 bg-[#FAF8F5] border border-[#EAE5DC] rounded-[12px] flex items-center justify-between text-xs text-[#45413B] font-body flex-wrap gap-2">
                    <div className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-[#386641]" />
                      <span><strong>{propZones.length}</strong> Zones</span>
                    </div>
                    <span className="text-[#C5BFAF]">·</span>
                    <div className="flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-[#2563EB]" />
                      <span><strong>{propRooms.length}</strong> Rooms</span>
                    </div>
                    <span className="text-[#C5BFAF]">·</span>
                    <div className="flex items-center gap-1.5">
                      <Bed className="w-3.5 h-3.5 text-[#C8681A]" />
                      <span><strong>{propDorms.length}</strong> Dorms</span>
                    </div>
                    <span className="text-[#C5BFAF]">·</span>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#7C6DAF]" />
                      <span><strong>{totalBeds}</strong> Total Beds</span>
                    </div>
                  </div>

                  {/* Property Manager Info */}
                  <div className="flex items-center justify-between pt-3 border-t border-[#F2ECE3] text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-[#EBF3EC] text-[#386641] flex items-center justify-center font-semibold text-[10px]">
                        PM
                      </div>
                      <div>
                        <p className="font-medium text-[#24221F] leading-tight">
                          {property.manager_name}
                        </p>
                        <p className="text-[11px] text-[#736E65]">{property.manager_email}</p>
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-[#386641] bg-[#EBF3EC] px-2 py-0.5 rounded-full">
                      Assigned Manager
                    </span>
                  </div>
                </div>

                {/* Primary CTA button to open property workspace */}
                <div className="pt-4 mt-2">
                  <Button
                    variant="sage"
                    size="sm"
                    className="w-full justify-between group-hover:bg-[#386641] group-hover:text-white transition-all"
                    onClick={() => handleOpenProperty(property.property_uid)}
                  >
                    <span>Open Property Workspace</span>
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Property Modal */}
      <CreatePropertyModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
      />

      {/* Edit Property Inline Modal */}
      {editingProperty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1D1B18]/40">
          <div className="w-full max-w-md bg-white border border-[#E4DFD5] rounded-[18px] p-6 shadow-xl">
            <h3 className="font-display font-bold text-lg text-[#24221F] mb-4">
              Edit Property Details
            </h3>
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1">
                  Property Name
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
                  Location / Address
                </label>
                <input
                  type="text"
                  required
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
                />
              </div>
              <div className="flex justify-end gap-2.5 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingProperty(null)}
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

      {/* Delete Confirmation Dialog */}
      {propertyToDelete && (
        <ConfirmationDialog
          isOpen={!!propertyToDelete}
          onClose={() => setPropertyToDelete(null)}
          onConfirm={() => deleteProperty(propertyToDelete.property_uid)}
          entityType="Property"
          entityName={propertyToDelete.name}
          impactMessage={`Deleting this property will delete all of its scoped zones, rooms, dorms, and manager assignments.`}
        />
      )}
    </div>
  );
};

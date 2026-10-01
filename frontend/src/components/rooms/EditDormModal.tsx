import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { AlertTriangle } from 'lucide-react';
import { zoneSupportsUnits } from '../../lib/zoneUtils';
import { Dorm } from '../../types';
import { DORM_TYPES, WASHROOM_TYPES } from './CreateDormModal';

interface EditDormModalProps {
  isOpen: boolean;
  dorm: Dorm;
  onClose: () => void;
}

export const EditDormModal: React.FC<EditDormModalProps> = ({ isOpen, dorm, onClose }) => {
  const { updateDorm, currentPropertyZones, currentPropertyDorms } = useApp();

  const currentBedCount = dorm.beds.length;
  const [name, setName] = useState(dorm.name);
  const [bedCount, setBedCount] = useState<number>(currentBedCount || 6);
  const [dormType, setDormType] = useState<(typeof DORM_TYPES)[number]>(
    (dorm.dorm_type as (typeof DORM_TYPES)[number]) || 'Mixed Dorm'
  );
  const [washroom, setWashroom] = useState<(typeof WASHROOM_TYPES)[number]>(
    (dorm.washroom as (typeof WASHROOM_TYPES)[number]) || 'Attached Washroom'
  );
  const [floor, setFloor] = useState(dorm.floor ?? '');
  const [areaSqft, setAreaSqft] = useState(String(dorm.area_sqft ?? ''));
  const [zoneUid, setZoneUid] = useState(dorm.zone_uid ?? '');
  const [description, setDescription] = useState(dorm.description ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Same name-conflict rule as create, but the dorm's own name doesn't count
  const nameTaken = useMemo(() => {
    const n = name.trim().toLowerCase();
    return (
      n !== '' &&
      currentPropertyDorms.some(
        (d) => d.dorm_uid !== dorm?.dorm_uid && d.name.toLowerCase().trim() === n
      )
    );
  }, [name, currentPropertyDorms, dorm]);

  const shrinking = bedCount < currentBedCount;
  const occupiedCount = dorm.beds.filter(
    (b) => b.is_occupied ?? b.status === 'occupied'
  ).length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || bedCount <= 0 || nameTaken || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await updateDorm(dorm.dorm_uid, {
        name: name.trim(),
        bed_count: bedCount,
        dorm_type: dormType,
        washroom: washroom,
        floor: floor.trim() || undefined,
        area_sqft: parseInt(areaSqft) || undefined,
        zone_uid: zoneUid ? zoneUid : null,
        description: description.trim() || undefined,
      });
      onClose();
    } catch {
      // Error toast handled by the context layer
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit ${dorm.name}`}
      description="Update dorm details. Changing bed count resizes the bed inventory."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
            Dorm Name / Number *
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Dorm 104 (Lotus Quarters)"
            className={`w-full px-3.5 py-2 bg-[#FAF8F5] border rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 ${
              nameTaken
                ? 'border-[#E5A3A3] focus:ring-[#C53B3B]'
                : 'border-[#DDD7CB] focus:ring-[#386641]'
            }`}
          />
          {nameTaken && (
            <p className="text-[11px] text-[#A82828] font-body mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              A dorm named "{name.trim()}" already exists in this property.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              Number of Beds *
            </label>
            <input
              type="number"
              min="1"
              max="200"
              required
              value={bedCount}
              onChange={(e) => setBedCount(parseInt(e.target.value) || 1)}
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
            />
            <span className="text-[11px] mt-0.5 block font-medium text-[#386641]">
              {bedCount > currentBedCount
                ? `Adds Bed ${String(currentBedCount + 1).padStart(2, '0')} through Bed ${String(bedCount).padStart(2, '0')}`
                : shrinking
                ? `Removes ${currentBedCount - bedCount} bed(s) — occupied ones are marked inactive`
                : `${bedCount} beds`}
            </span>
            {shrinking && occupiedCount > 0 && (
              <span className="text-[11px] text-[#A82828] mt-0.5 block font-medium">
                {occupiedCount} bed(s) currently occupied — they will be marked inactive,
                not deleted.
              </span>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              Dorm Type *
            </label>
            <select
              value={dormType}
              onChange={(e) => setDormType(e.target.value as (typeof DORM_TYPES)[number])}
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
            >
              {DORM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              Washroom Facility *
            </label>
            <select
              value={washroom}
              onChange={(e) => setWashroom(e.target.value as (typeof WASHROOM_TYPES)[number])}
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
            >
              {WASHROOM_TYPES.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              Assign to Zone
            </label>
            <select
              value={zoneUid}
              onChange={(e) => setZoneUid(e.target.value)}
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
            >
              <option value="">(Unallocated)</option>
              {currentPropertyZones.filter((z) => zoneSupportsUnits(z)).map((z) => (
                <option key={z.zone_uid} value={z.zone_uid}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              Floor (Optional)
            </label>
            <input
              type="text"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              placeholder="e.g. 2nd Floor"
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              Area (Sq Ft)
            </label>
            <input
              type="number"
              value={areaSqft}
              onChange={(e) => setAreaSqft(e.target.value)}
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
            Description (Optional)
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Locker specs, reading lights, AC schedule..."
            className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#F0ECE4]">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={nameTaken} isLoading={isSubmitting}>
            Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
};

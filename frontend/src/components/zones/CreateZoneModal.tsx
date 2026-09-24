import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ZoneType } from '../../types';
import { ZONE_TYPE_OPTIONS } from '../../lib/zoneUtils';

interface CreateZoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAreaUid?: string;
}

export const CreateZoneModal: React.FC<CreateZoneModalProps> = ({
  isOpen,
  onClose,
  defaultAreaUid,
}) => {
  const { createZone, currentPropertyAreas } = useApp();
  const [name, setName] = useState('');
  const [areaUid, setAreaUid] = useState(defaultAreaUid || '');
  const [zoneType, setZoneType] = useState<ZoneType>('stay');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Re-sync the preselected area each time the modal opens
  useEffect(() => {
    if (isOpen) setAreaUid(defaultAreaUid || '');
  }, [isOpen, defaultAreaUid]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await createZone({
        name: name.trim(),
        area_uid: areaUid || null,
        zone_type: zoneType,
        description: description.trim() || undefined,
      });
      setName('');
      setAreaUid('');
      setZoneType('stay');
      setDescription('');
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
      title="Create Physical Zone"
      description="Create a distinct physical wing, room sector, or operational zone in this property."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
            Zone Name *
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Zone D — East Garden Wing"
            className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] placeholder:text-[#9F998F] focus:outline-none focus:ring-2 focus:ring-[#386641]/25 focus:border-[#386641]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
            Area
          </label>
          <select
            value={areaUid}
            onChange={(e) => setAreaUid(e.target.value)}
            className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]/25 focus:border-[#386641] cursor-pointer"
          >
            <option value="">Unassigned</option>
            {currentPropertyAreas.map((a) => (
              <option key={a.area_uid} value={a.area_uid}>
                {a.name}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-[#787268] mt-1.5 font-body">
            {currentPropertyAreas.length === 0
              ? 'No areas yet — the zone will be unassigned. Create an area first to group zones.'
              : 'Which area this zone belongs to. Leave unassigned to assign later.'}
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
            Zone Type *
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ZONE_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setZoneType(opt.value)}
                className={`p-2.5 rounded-[10px] border text-left transition-all cursor-pointer ${
                  zoneType === opt.value
                    ? 'border-[#386641] bg-[#EBF3EC] ring-1 ring-[#386641]/30'
                    : 'border-[#DDD7CB] bg-[#FAF8F5] hover:bg-[#F2ECE3]'
                }`}
              >
                <span
                  className={`block text-xs font-semibold ${
                    zoneType === opt.value ? 'text-[#244E2C]' : 'text-[#555047]'
                  }`}
                >
                  {opt.label}
                </span>
                <span className="block text-[10px] text-[#736E65] mt-0.5 leading-tight">
                  {opt.hint}
                </span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[#787268] mt-1.5 font-body">
            {zoneType === 'stay'
              ? 'Stay zones can contain rooms, dorms and beds.'
              : 'This zone type cannot contain rooms, dorms or beds — only staff and tasks.'}
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
            Description & Purpose (Optional)
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the physical boundaries, facilities, and staff assignments..."
            className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] placeholder:text-[#9F998F] focus:outline-none focus:ring-2 focus:ring-[#386641]/25 focus:border-[#386641]"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#F0ECE4]">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            Create Zone
          </Button>
        </div>
      </form>
    </Modal>
  );
};

import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ROOM_TYPES } from './CreateRoomModal';
import { Layers, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface BulkCreateRoomsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BulkCreateRoomsModal: React.FC<BulkCreateRoomsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { bulkCreateRooms, currentPropertyRooms, currentPropertyZones } = useApp();

  const [startNum, setStartNum] = useState<number>(201);
  const [endNum, setEndNum] = useState<number>(208);
  const [roomType, setRoomType] = useState<string>(ROOM_TYPES[1]);
  const [areaSqft, setAreaSqft] = useState<number>(250);
  const [zoneUid, setZoneUid] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Existing room numbers in property
  const existingSet = useMemo(() => {
    return new Set(currentPropertyRooms.map((r) => r.room_number.toLowerCase().trim()));
  }, [currentPropertyRooms]);

  // Live range preview and duplicate check
  const { previewRooms, duplicateRooms, validCount } = useMemo(() => {
    const list: string[] = [];
    const dupes: string[] = [];

    const start = Math.min(startNum, endNum);
    const end = Math.max(startNum, endNum);

    // Limit maximum preview to 50 rooms to keep fast
    const safeEnd = Math.min(end, start + 49);

    for (let i = start; i <= safeEnd; i++) {
      const s = String(i);
      list.push(s);
      if (existingSet.has(s.toLowerCase())) {
        dupes.push(s);
      }
    }

    return {
      previewRooms: list,
      duplicateRooms: dupes,
      validCount: list.length - dupes.length,
    };
  }, [startNum, endNum, existingSet]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (startNum <= 0 || endNum <= 0 || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await bulkCreateRooms({
        start: Math.min(startNum, endNum),
        end: Math.max(startNum, endNum),
        type: roomType,
        area_sqft: areaSqft,
        zone_uid: zoneUid ? zoneUid : null,
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
      title="Bulk Create Rooms"
      description="Enter a range (e.g. 201–209) to preview, validate duplicates, and batch create."
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Range Inputs */}
        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              Start Room Number *
            </label>
            <input
              type="number"
              min="1"
              required
              value={startNum}
              onChange={(e) => setStartNum(parseInt(e.target.value) || 0)}
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              End Room Number *
            </label>
            <input
              type="number"
              min="1"
              required
              value={endNum}
              onChange={(e) => setEndNum(parseInt(e.target.value) || 0)}
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              Room Type
            </label>
            <select
              value={roomType}
              onChange={(e) => setRoomType(e.target.value)}
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
            >
              {ROOM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
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
              {currentPropertyZones.map((z) => (
                <option key={z.zone_uid} value={z.zone_uid}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Live Preview & Duplicate Validation Box (per spec: previews resulting numbers and validates against duplicates) */}
        <div className="p-4 rounded-[14px] bg-[#FAF8F5] border border-[#E4DFD5] space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#45413B] uppercase tracking-wider">
              Range Preview ({previewRooms.length} Total)
            </span>
            {duplicateRooms.length > 0 ? (
              <span className="text-[#C53B3B] font-medium flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {duplicateRooms.length} Duplicates Detected
              </span>
            ) : (
              <span className="text-[#386641] font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                All Numbers Available
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
            {previewRooms.map((num) => {
              const isDupe = duplicateRooms.includes(num);
              return (
                <span
                  key={num}
                  className={`text-xs px-2.5 py-1 rounded-[6px] font-mono font-medium border ${
                    isDupe
                      ? 'bg-[#FDE8E8] text-[#A82828] border-[#F9C3C3] line-through'
                      : 'bg-[#FFFFFF] text-[#24221F] border-[#DDD7CB]'
                  }`}
                  title={isDupe ? `Room ${num} already exists in property` : `Ready to create`}
                >
                  {num}
                </span>
              );
            })}
          </div>

          {duplicateRooms.length > 0 && (
            <p className="text-[11px] text-[#A82828] font-body leading-tight">
              Existing rooms ({duplicateRooms.join(', ')}) will be automatically skipped to prevent collisions.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#F0ECE4]">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={validCount === 0 || isSubmitting}
            isLoading={isSubmitting}
          >
            Create {validCount} Rooms
          </Button>
        </div>
      </form>
    </Modal>
  );
};

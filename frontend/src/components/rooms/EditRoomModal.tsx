import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { AlertTriangle } from 'lucide-react';
import { zoneSupportsUnits } from '../../lib/zoneUtils';
import { Room } from '../../types';
import { ROOM_TYPES } from './CreateRoomModal';

interface EditRoomModalProps {
  isOpen: boolean;
  room: Room;
  onClose: () => void;
}

export const EditRoomModal: React.FC<EditRoomModalProps> = ({ isOpen, room, onClose }) => {
  const { updateRoom, currentPropertyZones, currentPropertyRooms } = useApp();

  const isPreset = (ROOM_TYPES as readonly string[]).includes(room.type);
  const [roomNumber, setRoomNumber] = useState(room.room_number);
  const [type, setType] = useState(isPreset ? room.type : 'Custom...');
  const [customType, setCustomType] = useState(isPreset ? '' : room.type);
  const [areaSqft, setAreaSqft] = useState(String(room.area_sqft ?? 260));
  const [zoneUid, setZoneUid] = useState<string>(room.zone_uid ?? '');
  const [cleaningNote, setCleaningNote] = useState(room.cleaning_note ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Same conflict rule as create, but the room's own number doesn't count
  const roomNumberTaken = useMemo(() => {
    const n = roomNumber.trim().toLowerCase();
    return (
      n !== '' &&
      currentPropertyRooms.some(
        (r) => r.room_uid !== room?.room_uid && r.room_number.toLowerCase().trim() === n
      )
    );
  }, [roomNumber, currentPropertyRooms, room]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomNumber.trim() || roomNumberTaken || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await updateRoom(room.room_uid, {
        room_number: roomNumber.trim(),
        type: type === 'Custom...' ? customType.trim() || 'Private Room' : type,
        area_sqft: parseInt(areaSqft) || undefined,
        zone_uid: zoneUid ? zoneUid : null,
        cleaning_note: cleaningNote.trim() || undefined,
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
      title={`Edit Room ${room.room_number}`}
      description="Update room details, specs and zone allocation"
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
            Room Number *
          </label>
          <input
            type="text"
            required
            value={roomNumber}
            onChange={(e) => setRoomNumber(e.target.value)}
            placeholder="e.g. 205"
            className={`w-full px-3.5 py-2 bg-[#FAF8F5] border rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 ${
              roomNumberTaken
                ? 'border-[#E5A3A3] focus:ring-[#C53B3B]'
                : 'border-[#DDD7CB] focus:ring-[#386641]'
            }`}
          />
          {roomNumberTaken && (
            <p className="text-[11px] text-[#A82828] font-body mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              A room named "{roomNumber.trim()}" already exists in this property.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
              Room Type *
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
            >
              {ROOM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              <option value="Custom...">Custom Type...</option>
            </select>
          </div>

          {type === 'Custom...' && (
            <div>
              <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
                Specify Custom Type
              </label>
              <input
                type="text"
                required
                value={customType}
                onChange={(e) => setCustomType(e.target.value)}
                placeholder="e.g. Presidential Penthouse"
                className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
              />
            </div>
          )}

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

        <div>
          <label className="block text-xs font-semibold text-[#45413B] uppercase tracking-wider mb-1 font-body">
            Cleaning Note (Optional)
          </label>
          <input
            type="text"
            value={cleaningNote}
            onChange={(e) => setCleaningNote(e.target.value)}
            placeholder="e.g. Deep clean required — stained carpet"
            className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#DDD7CB] rounded-[10px] text-sm text-[#24221F] focus:outline-none focus:ring-2 focus:ring-[#386641]"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#F0ECE4]">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={roomNumberTaken} isLoading={isSubmitting}>
            Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
};
